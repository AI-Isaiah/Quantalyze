"""Phase 167.2.1.1.1 NAVMTM plan 09 - composite strategies use their members' stored marks (SC-2, D-05, D-12, D-14, L3).

What these pin, and why each can fail
-------------------------------------
A composite strategy is a strategy with a factsheet, and ``run_stitch_composite_job`` does NOT
read its members' stored return rows: it reconstructs each member live (``_reconstruct_ccxt_member``
for the ccxt venues, ``_reconstruct_deribit`` for Deribit) and stitches the result. Without this
plan every composite would stay realized-basis while a single-key strategy moved to marks. The rule
is plan 03's ``apply_marks`` applied PER MEMBER, on the member's own cash-basis series, BEFORE the
member is clipped to its window (a clip first would cut the base days the first mark is measured
against).

Every expected number is a literal typed beside its arithmetic. The oracles are the stored marks,
the faked member series and this module's own arithmetic, never ``apply_marks`` or the job.

The harness runs the REAL ``run_stitch_composite_job`` over a faked supabase, faked venue fetches
and a faked ``combine_realized_and_funding`` (each member's realized series is typed in the test).
Stored marks are served by a stand-in for ``read_key_marks`` keyed on the member's key id.
"""
from __future__ import annotations

import datetime as dt
from contextlib import ExitStack
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.external_flows import ExternalFlow, FlowInstant
from services.job_worker import DispatchOutcome, run_stitch_composite_job
from services.nav_marks import StoredMark
from services.nav_marks_apply import MarkedSeries
from services.stitch_composite import coverage_mask
from tests.test_stitch_composite_job import (
    _STRATEGY_ID,
    _FakeSupabase,
    _ctx,
    _deribit_patches,
    _member,
    _returns,
)

#: The strategy row of an UNCONFIGURED composite (no returns_denominator_config).
_PLAIN_STRATEGY = {"id": _STRATEGY_ID, "asset_class": "crypto", "returns_denominator_config": None}

#: A returns_denominator_config on the composite. A ccxt member still returns NAV changes (D-14).
_CONFIG = {
    "denominator": "allocated_capital",
    "pnl_basis": "cash_settlement",
    "capital_schedule": [{"effective_from": "2026-01-01", "capital_usd": 1_000_000}],
    "metrics_basis": "calendar_day",
    "cumulative_method": "simple",
}
_CONFIGURED_STRATEGY = {
    "id": _STRATEGY_ID, "asset_class": "crypto", "returns_denominator_config": _CONFIG,
}

#: The member series the faked combiner yields. Member 1 (key-1) ends 02-28; member 2 (key-2)
#: is realized through 03-05, the day its realized terminal is stated on.
M1_FULL = {"2026-02-26": 0.010, "2026-02-27": -0.004, "2026-02-28": 0.006}
M2_FULL = {
    "2026-03-01": 0.010, "2026-03-02": -0.005, "2026-03-03": 0.002,
    "2026-03-04": 0.003, "2026-03-05": 0.004,
}

#: The faked equity read of every ccxt member: equity 1010.0 with open profit 10.0, so the
#: realized terminal of member 2 is 1010.0 - 10.0 = 1000.0 on its last return day, 03-05.
EQUITY_READ = (1010.0, False, 10.0, False)

#: Member 2's stored marks: 03-06 = 1050.0, 03-07 = 1071.0, 03-09 = 1092.42 (03-08 is unmarked).
#: r(03-06) = (1050.0 - 1000.0) / 1000.0 = 0.05;  r(03-07) = (1071.0 - 1050.0) / 1050.0 = 0.02;
#: r(03-09) = (1092.42 - 1071.0) / 1071.0 = 0.02 (one return spanning the unmarked 03-08).
R_0306 = (1050.0 - 1000.0) / 1000.0
R_0307 = (1071.0 - 1050.0) / 1050.0
R_0309 = (1092.42 - 1071.0) / 1071.0


def stored(day: str, nav: float, *, venue: str = "okx", open_pnl: float = 0.0) -> StoredMark:
    d = dt.date.fromisoformat(day)
    at = dt.datetime(d.year, d.month, d.day, 0, 10, tzinfo=dt.timezone.utc) + dt.timedelta(days=1)
    return StoredMark(day, at.isoformat(), venue, nav, open_pnl, nav, "USD", open_pnl)


#: The first mark's wallet is 1000.0 (nav 1050.0 less open profit 50.0): that is the base its
#: return is measured against (plan 03 rule 3).
MARKS_KEY2 = [
    stored("2026-03-06", 1050.0, open_pnl=50.0),
    stored("2026-03-07", 1071.0, open_pnl=71.0),
    stored("2026-03-09", 1092.42, open_pnl=92.42),
]


def day_series(values: dict[str, float]) -> pd.Series:
    return _returns(list(values.items()))


class Run:
    """What one composite run did: the result, the faked store and the captured pieces."""

    def __init__(self, result: Any, fake: _FakeSupabase, scalar_inputs: list[pd.Series]) -> None:
        self.result = result
        self.fake = fake
        self.scalar_inputs = scalar_inputs

    def csv_rows(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for table, payload, _c in self.fake.upserts:
            if table == "csv_daily_returns":
                for r in payload:
                    out[r["date"]] = r["daily_return"]
        return dict(sorted(out.items()))

    def headline(self) -> dict[str, Any] | None:
        for table, payload, _c in reversed(self.fake.upserts):
            if (
                table == "strategy_analytics" and isinstance(payload, dict)
                and "metrics_json_by_basis" in payload
            ):
                return payload
        return None

    def flags(self) -> dict[str, Any]:
        head = self.headline()
        assert head is not None, "no headline write happened"
        flags = head["data_quality_flags"]
        assert isinstance(flags, dict)
        return flags

    def series_payload(self, kind: str) -> dict[str, Any]:
        for name, args in reversed(self.fake.rpc_calls):
            if name == "upsert_strategy_analytics_series_batch" and kind in args["p_kinds"]:
                payload = args["p_kinds"][kind]
                assert isinstance(payload, dict)
                return payload
        raise AssertionError(f"no {kind} series was persisted")

    def wrote_anything_but_a_failed_stamp(self) -> bool:
        for table, payload, _c in self.fake.upserts:
            if table == "csv_daily_returns":
                return True
            if table == "strategy_analytics" and isinstance(payload, dict):
                if payload.get("computation_status") != "failed" or "metrics_json_by_basis" in payload:
                    return True
        return bool(self.fake.rpc_calls)


async def run_ccxt_composite(
    *,
    windows: list[tuple[str, str | None]],
    series: list[dict[str, float]],
    marks: dict[str, list[StoredMark]] | None = None,
    strategy_row: dict[str, Any] | None = None,
    existing_flags: dict[str, Any] | None = None,
    equity: tuple[Any, bool, float, bool] = EQUITY_READ,
    flows: list[ExternalFlow] | None = None,
    flow_instants: list[FlowInstant] | None = None,
    venue: str = "okx",
    spy_scalar: bool = False,
    now: dt.datetime | None = None,
) -> Run:
    """Run the real composite job over ``len(windows)`` ccxt members (key-1, key-2, ...).

    ``series`` is each member's FULL realized series, in seq order (the combiner yields them one
    per call, in order, and the cash pass is the only pass a ccxt-only composite makes)."""
    members = [_member(i + 1, ws, we) for i, (ws, we) in enumerate(windows)]
    fake = _FakeSupabase(
        members=members,
        strategy_row=strategy_row if strategy_row is not None else dict(_PLAIN_STRATEGY),
        existing_flags=existing_flags,
    )
    ctxs: dict[str, MagicMock] = {}
    for m in members:
        c = _ctx(venue)
        c.key_row = {"id": m["api_key_id"], "user_id": "owner-1", "exchange": venue}
        ctxs[m["api_key_id"]] = c

    async def _preflight(member_job: dict[str, Any], _caller: str) -> MagicMock:
        return ctxs[member_job["api_key_id"]]

    served = marks or {}
    scalar_inputs: list[pd.Series] = []

    import services.basis_series as _bs

    real_compute = _bs.compute_all_metrics

    def _spy(returns: pd.Series, *a: Any, **k: Any) -> Any:
        scalar_inputs.append(returns.copy())
        return real_compute(returns, *a, **k)

    def _dated_flows(*_args: Any, instants: list[FlowInstant] | None = None, **_kw: Any) -> Any:
        if instants is not None:
            instants.extend(flow_instants or [])
        return list(flows or [])

    meta = {"used_heuristic_capital": False}
    patches = [
        patch("services.job_worker.get_supabase", new=MagicMock(return_value=fake)),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        patch("services.job_worker._allocator_key_preflight", new=AsyncMock(side_effect=_preflight)),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.job_worker.read_key_marks",
            new=MagicMock(side_effect=lambda _sb, key_id: list(served.get(key_id, []))),
        ),
        patch("services.exchange.fetch_account_equity_and_upnl_usd", new=AsyncMock(return_value=equity)),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
        patch("services.funding_fetch.fetch_funding_okx", new=AsyncMock(return_value=[])),
        patch("services.funding_fetch.fetch_funding_binance", new=AsyncMock(return_value=[])),
        patch("services.funding_fetch.fetch_funding_bybit", new=AsyncMock(return_value=[])),
        patch("services.ccxt_flow_fetch.fetch_ccxt_transfers", new=AsyncMock(return_value=[])),
        patch("services.job_worker._resolve_ccxt_flow_price_index", new=AsyncMock(return_value={})),
        patch(
            "services.ccxt_flows.ccxt_rows_to_dated_flows",
            new=MagicMock(side_effect=_dated_flows),
        ),
        # The DQ-02 flow-coverage terminus reads the wall clock against the venue's deposit
        # retention; it is not what this module pins, so it is held off (no truncation).
        patch("services.nav_twr.flow_coverage_terminus_day", new=MagicMock(return_value=None)),
        patch(
            "services.broker_dailies.combine_realized_and_funding",
            new=MagicMock(side_effect=[(day_series(s), dict(meta)) for s in series]),
        ),
        patch("services.benchmark.get_benchmark_returns", new=AsyncMock(return_value=(None, True))),
    ]
    if spy_scalar:
        patches.append(patch("services.basis_series.compute_all_metrics", new=_spy))
    if now is not None:
        patches.append(patch("services.job_worker._utc_now", new=MagicMock(return_value=now)))
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    return Run(result, fake, scalar_inputs)


# --------------------------------------------------------------------------------------
# Task 1 - the tracer: one OKX member with stored marks inside a two-member composite
# --------------------------------------------------------------------------------------

_TWO_MEMBERS = [("2026-01-01", "2026-03-01"), ("2026-03-01", None)]
_TWO_MEMBERS_MARCH_10 = [("2026-01-01", "2026-03-10"), ("2026-03-10", None)]


@pytest.mark.asyncio
async def test_member_marks_drive_the_stitched_series() -> None:
    """Member 2's first mark carries a wallet of 1000.0 (realized through 03-05), its
    stored marks are 03-06 = 1050.0, 03-07 = 1071.0 and 03-09 = 1092.42. The stitched rows on
    those days are 0.05, 0.02 and (1092.42 - 1071.0) / 1071.0, there is no row on the unmarked
    03-08, and member 1 (no marks) and member 2's pre-mark days are what the no-marks run gives."""
    run = await run_ccxt_composite(
        windows=_TWO_MEMBERS, series=[M1_FULL, M2_FULL], marks={"key-2": MARKS_KEY2},
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    rows = run.csv_rows()
    assert rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx(0.02, abs=1e-12)
    assert rows["2026-03-09"] == pytest.approx(R_0309, abs=1e-12)
    assert "2026-03-08" not in rows, "an unmarked day has no row of its own (D-05)"
    assert sorted(rows) == [*M1_FULL, *M2_FULL, "2026-03-06", "2026-03-07", "2026-03-09"]

    baseline = await run_ccxt_composite(windows=_TWO_MEMBERS, series=[M1_FULL, M2_FULL])
    base_rows = baseline.csv_rows()
    assert base_rows == {**M1_FULL, **M2_FULL}
    assert {d: v for d, v in rows.items() if d <= "2026-03-05"} == base_rows


@pytest.mark.asyncio
async def test_marks_apply_before_the_window_clip() -> None:
    """The member's window opens on its first mark day, so every realized day lies BEFORE the
    window and only a base taken from the member's UNCLIPPED series can value the first mark
    (a clip first leaves the apply no base day and no row on 03-06). Member 2's first mark has a
    wallet of 1000.0 on a realized series ending 03-05, the marks are 1050.0 (03-06) and 1071.0 (03-07):
    r(03-06) = (1050.0 - 1000.0) / 1000.0 = 0.05 and r(03-07) = (1071.0 - 1050.0) / 1050.0 = 0.02."""
    run = await run_ccxt_composite(
        windows=[("2026-01-01", "2026-03-06"), ("2026-03-06", None)],
        series=[{**M1_FULL, **M2_FULL}, M2_FULL],
        marks={"key-2": MARKS_KEY2[:2]},
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    rows = run.csv_rows()
    assert rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx(0.02, abs=1e-12)
    assert max(rows) == "2026-03-07"


# A real inter-member gap: member 1 ends 02-20 and member 2 starts 03-01 (02-20 .. 02-28 is
# nine calendar days no member covers).
_GAP_WINDOWS = [("2026-01-01", "2026-02-20"), ("2026-03-01", None)]
_GAP_M1 = {"2026-02-16": 0.010, "2026-02-17": -0.004, "2026-02-18": 0.006, "2026-02-19": 0.002}


@pytest.mark.asyncio
async def test_covered_days_are_not_composite_gaps_but_inter_member_gaps_are() -> None:
    """With marks, 03-08 (inside member 2's marked span) is no gap span, while the real
    inter-member hole 02-20 .. 02-28 is still one gap span of nine days, exactly as without marks."""
    marked = await run_ccxt_composite(
        windows=_GAP_WINDOWS, series=[_GAP_M1, M2_FULL], marks={"key-2": MARKS_KEY2},
    )
    plain = await run_ccxt_composite(windows=_GAP_WINDOWS, series=[_GAP_M1, M2_FULL])
    assert marked.result.outcome == DispatchOutcome.DONE, marked.result.error_message
    assert plain.result.outcome == DispatchOutcome.DONE, plain.result.error_message
    real_gap = [{"start": "2026-02-20", "end": "2026-02-28"}]
    assert plain.flags()["gap_spans"] == real_gap
    assert plain.flags()["gap_day_count"] == 9
    assert marked.flags()["gap_spans"] == real_gap, "03-08 is covered by 03-09's return, not a hole"
    assert marked.flags()["gap_day_count"] == 9
    # The persisted cash series states the same: one covered day, and the gap is only the real one.
    cash = marked.series_payload("cash_settlement")
    assert cash["gap_spans"] == real_gap
    assert cash["conventions"]["covered_day_count"] == 1


@pytest.mark.asyncio
async def test_covered_day_is_not_zero_filled_in_the_headline_scalar_input() -> None:
    """The scalar input the headline is computed on has no row on 03-08 (a covered day is not a
    flat day) and still carries 0.0 rows on every day of the inter-member gap (a real hole stays
    0.0-filled, exactly as today)."""
    run = await run_ccxt_composite(
        windows=_GAP_WINDOWS, series=[_GAP_M1, M2_FULL], marks={"key-2": MARKS_KEY2},
        spy_scalar=True,
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    assert run.scalar_inputs, "compute_all_metrics was never reached"
    scalar = run.scalar_inputs[0]
    days = {ts.date().isoformat(): float(v) for ts, v in scalar.items()}
    assert "2026-03-08" not in days
    gap_days = [f"2026-02-{d:02d}" for d in range(20, 29)]
    assert [days[d] for d in gap_days] == [0.0] * 9
    assert days["2026-03-09"] == pytest.approx(R_0309, abs=1e-12)
    assert days["2026-03-06"] == pytest.approx(0.05, abs=1e-12)


@pytest.mark.asyncio
async def test_composite_flags_name_the_marks() -> None:
    """merged_flags carry marks_since and mark_gap_days (present-only), and the marks never
    promote the computation status."""
    run = await run_ccxt_composite(
        windows=_TWO_MEMBERS, series=[M1_FULL, M2_FULL], marks={"key-2": MARKS_KEY2},
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    flags = run.flags()
    assert flags["marks_since"] == "2026-03-06"
    assert flags["mark_gap_days"] == ["2026-03-08"]
    head = run.headline()
    assert head is not None
    assert head["computation_status"] == "complete", "a mark annotation is never a warning"


@pytest.mark.asyncio
async def test_a_member_deposit_is_placed_by_its_instant_against_the_read() -> None:
    """D-23 on a composite member. A 5.0 deposit dated 03-07 sits on the read day of the 03-06 mark
    (read 00:10Z on 03-07). Made at 00:05Z it is inside that mark (NAV 1055.0, wallet 1005.0): the
    03-06 return is (1055 - 1000 - 5) / 1000 = 0.05 and 03-07 is (1071 - 1055) / 1055. Made at
    00:15Z it stays on 03-07, in that day's numerator: (1071 - 1050 - 5) / 1050."""
    flow = ExternalFlow(utc_day_iso="2026-03-07", usd_signed=5.0)

    def at(minute: int) -> list[FlowInstant]:
        ms = int(dt.datetime(2026, 3, 7, 0, minute, tzinfo=dt.timezone.utc).timestamp() * 1000)
        return [FlowInstant(ms, "2026-03-07", 5.0)]

    before = await run_ccxt_composite(
        windows=_TWO_MEMBERS, series=[M1_FULL, M2_FULL],
        marks={"key-2": [stored("2026-03-06", 1055.0, open_pnl=50.0), stored("2026-03-07", 1071.0, open_pnl=71.0)]},
        flows=[flow], flow_instants=at(5),
    )
    assert before.result.outcome == DispatchOutcome.DONE, before.result.error_message
    assert before.csv_rows()["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert before.csv_rows()["2026-03-07"] == pytest.approx((1071.0 - 1055.0) / 1055.0, abs=1e-12)
    assert "mark_flow_read_days" not in before.flags()

    after = await run_ccxt_composite(
        windows=_TWO_MEMBERS, series=[M1_FULL, M2_FULL], marks={"key-2": MARKS_KEY2},
        flows=[flow], flow_instants=at(15),
    )
    assert after.result.outcome == DispatchOutcome.DONE, after.result.error_message
    assert after.csv_rows()["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert after.csv_rows()["2026-03-07"] == pytest.approx((1071.0 - 1050.0 - 5.0) / 1050.0, abs=1e-12)


@pytest.mark.asyncio
async def test_no_member_marks_is_byte_identical() -> None:
    """No stored mark for any member: the persisted cash rows are the stitched members verbatim,
    the flags and the series conventions say nothing about marks, and ``apply_marks`` is never
    called (so the unchanged path cannot be reached through it by accident)."""
    with patch("services.job_worker.apply_marks", side_effect=AssertionError("apply_marks was called")):
        run = await run_ccxt_composite(windows=_TWO_MEMBERS, series=[M1_FULL, M2_FULL])
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    assert run.csv_rows() == {**M1_FULL, **M2_FULL}
    flags = run.flags()
    for key in ("marks_since", "mark_gap_days"):
        assert key not in flags
    assert "covered_day_count" not in run.series_payload("cash_settlement")["conventions"]
    assert flags["gap_day_count"] == 0 and flags["gap_spans"] == []


def test_coverage_mask_covered_days_argument() -> None:
    """Pure. Absent days named in ``covered_days`` are not counted as gaps; an unnamed absent day
    still is; a named day that HAS a row changes nothing; the default None (and an empty
    collection) is byte-identical to the one-argument call."""
    s1 = _returns([("2026-03-01", 0.1), ("2026-03-02", 0.1)])
    s2 = _returns([("2026-03-05", 0.1)])
    base = coverage_mask([(1, s1), (2, s2)])
    assert base["gap_day_count"] == 2
    assert base["gap_spans"] == [{"start": "2026-03-03", "end": "2026-03-04"}]

    covered = coverage_mask([(1, s1), (2, s2)], covered_days=["2026-03-03"])
    assert covered["gap_day_count"] == 1
    assert covered["gap_spans"] == [{"start": "2026-03-04", "end": "2026-03-04"}]

    assert coverage_mask([(1, s1), (2, s2)], covered_days=["2026-03-01"]) == base
    assert coverage_mask([(1, s1), (2, s2)], covered_days=None) == base
    assert coverage_mask([(1, s1), (2, s2)], covered_days=[]) == base


# --------------------------------------------------------------------------------------
# Task 2 - Deribit members, the configured composite, stale flags, the whole-composite refusal
# --------------------------------------------------------------------------------------


async def run_deribit_composite(
    *,
    marks: dict[str, list[StoredMark]] | None = None,
    strategy_row: dict[str, Any] | None = None,
) -> tuple[Run, dict[str, MagicMock]]:
    """Run the real composite job over two perp-only Deribit members (key-1, key-2). The
    mark_to_market second pass runs (an all-Deribit perp book is MTM-admissible), so the call
    order of the faked combiner is: cash m1, cash m2, then mtm m1, mtm m2. The three NAV-path
    ledger helpers answer literals: no flows, no P&L."""
    members = [_member(1, "2026-01-01", "2026-03-01"), _member(2, "2026-03-01", None)]
    fake = _FakeSupabase(
        members=members,
        strategy_row=strategy_row if strategy_row is not None else dict(_PLAIN_STRATEGY),
    )
    ctxs: dict[str, MagicMock] = {}
    for m in members:
        c = _ctx("deribit")
        c.key_row = {"id": m["api_key_id"], "user_id": "owner-1", "exchange": "deribit"}
        ctxs[m["api_key_id"]] = c

    async def _preflight(member_job: dict[str, Any], _caller: str) -> MagicMock:
        return ctxs[member_job["api_key_id"]]

    served = marks or {}
    cash_m1, cash_m2 = day_series(M1_FULL), day_series(M2_FULL)
    # The mark_to_market pass yields its own (arbitrary, distinct) series.
    mtm_m1 = day_series({d: v * 2.0 for d, v in M1_FULL.items()})
    mtm_m2 = day_series({d: v * 2.0 for d, v in M2_FULL.items()})
    patches = [
        *_deribit_patches(
            fake,
            combine_returns=[(cash_m1, {}), (cash_m2, {}), (mtm_m1, {}), (mtm_m2, {})],
            has_option_activity=False,
        ),
        patch("services.job_worker._allocator_key_preflight", new=AsyncMock(side_effect=_preflight)),
        patch(
            "services.job_worker.read_key_marks",
            new=MagicMock(side_effect=lambda _sb, key_id: list(served.get(key_id, []))),
        ),
        patch(
            "services.broker_dailies.native_ledger_composed_flows",
            new=MagicMock(return_value=pd.Series(dtype="float64")),
        ),
        patch(
            "services.broker_dailies.native_ledger_day_pnl",
            new=MagicMock(return_value=pd.Series(dtype="float64")),
        ),
    ]
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    return Run(result, fake, []), ctxs


@pytest.mark.asyncio
async def test_deribit_member_marks_apply_to_cash_only() -> None:
    """A Deribit member of an UNCONFIGURED composite takes its marks on the cash basis: member 2's
    cash rows on 03-06, 03-07 and 03-09 are 0.05, 0.02 and (1092.42 - 1071.0) / 1071.0 from its
    realized terminal 1000.0 on 03-05, and the mark_to_market series is exactly what the no-marks
    run persists (the second pass is not marked, by decision, as in plan 07)."""
    marked, _ = await run_deribit_composite(marks={"key-2": MARKS_KEY2})
    plain, _ = await run_deribit_composite()
    assert marked.result.outcome == DispatchOutcome.DONE, marked.result.error_message
    assert plain.result.outcome == DispatchOutcome.DONE, plain.result.error_message
    rows = marked.csv_rows()
    assert rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx(0.02, abs=1e-12)
    assert rows["2026-03-09"] == pytest.approx(R_0309, abs=1e-12)
    assert "2026-03-08" not in rows
    assert plain.csv_rows() == {**M1_FULL, **M2_FULL}
    assert marked.flags()["marks_since"] == "2026-03-06"
    # The mark_to_market basis is untouched: byte-equal rows and no covered-day echo.
    mtm_marked = marked.series_payload("mtm_daily_returns")
    mtm_plain = plain.series_payload("mtm_daily_returns")
    assert mtm_marked["rows"] == mtm_plain["rows"]
    assert mtm_marked["conventions"] == mtm_plain["conventions"]
    assert "covered_day_count" not in mtm_marked["conventions"]
    assert marked.series_payload("cash_settlement")["conventions"]["covered_day_count"] == 1


@pytest.mark.asyncio
async def test_configured_composite_ccxt_member_applies_marks() -> None:
    """BLOCKER 1 / D-14. A returns_denominator_config on the COMPOSITE does not make a ccxt
    member's returns allocated-capital returns (only a Deribit member's combiner does that), so
    Task 1's OKX member applies its marks by the returns roll: the same literals."""
    run = await run_ccxt_composite(
        windows=_TWO_MEMBERS, series=[M1_FULL, M2_FULL], marks={"key-2": MARKS_KEY2},
        strategy_row=dict(_CONFIGURED_STRATEGY),
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    rows = run.csv_rows()
    assert rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx(0.02, abs=1e-12)
    assert rows["2026-03-09"] == pytest.approx(R_0309, abs=1e-12)
    assert run.flags()["marks_since"] == "2026-03-06"


@pytest.mark.asyncio
async def test_configured_composite_deribit_member_is_no_longer_left_alone() -> None:
    """The Deribit member of a composite WITH a returns_denominator_config returns
    allocated-capital P&L, which this plan's returns roll cannot value; plan 09 left it behind the
    selector and plan 17 (D-14) wired it on the NAV twin and the day-P&L roll
    (``test_nav_marks_composite_allocated.py``). This pins that hand-off is closed: with a stored
    in-window mark the member is no longer stitched unmarked. The harness' stub ledger builds no
    twin, so the composite refuses by name (W1) rather than silently publishing realized rows."""
    marked, _ = await run_deribit_composite(
        marks={"key-2": MARKS_KEY2}, strategy_row=dict(_CONFIGURED_STRATEGY)
    )
    assert marked.result.outcome == DispatchOutcome.FAILED
    assert marked.result.error_message == (
        "run_stitch_composite_job: nav marks refused (seq=2, mark_allocated_nav_unreconciled)"
    )
    assert not marked.wrote_anything_but_a_failed_stamp()


@pytest.mark.asyncio
async def test_stale_navmtm_flags_are_popped() -> None:
    """Info 6. The composite path MERGES into the existing flags. A composite whose flags carry
    marks_since and mark_gap_days from an earlier stitch re-stitches with no member marks: both
    are gone from the persisted flags, so a stale start date or gap list never outlives the
    stitch that computed it."""
    stale = {
        "marks_since": "2026-03-06",
        "mark_gap_days": ["2026-03-08"],
    }
    run = await run_ccxt_composite(
        windows=_TWO_MEMBERS, series=[M1_FULL, M2_FULL], existing_flags=dict(stale),
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    flags = run.flags()
    for key in stale:
        assert key not in flags, f"{key} outlived the stitch that computed it"
    assert flags["composite"] is True, "the rest of the existing flags are still merged"


@pytest.mark.asyncio
async def test_a_member_with_a_nonpositive_first_base_still_stitches() -> None:
    """CR-02. Member 2's first mark has NAV 1050.0 and open profit 1140.0, so its wallet and base
    are 1050.0 - 1140.0 = -90.0, not positive. That is a gap on 03-06 (no return of its own), not
    a refusal of the whole composite: marks and flows are history, so a refusal would stop the
    composite on every later run. 03-07 is measured from the stored 1050.0."""
    run = await run_ccxt_composite(
        windows=_TWO_MEMBERS, series=[M1_FULL, M2_FULL],
        marks={"key-2": [stored("2026-03-06", 1050.0, open_pnl=1140.0), *MARKS_KEY2[1:]]},
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    rows = run.csv_rows()
    assert "2026-03-06" not in rows
    assert rows["2026-03-07"] == pytest.approx((1071.0 - 1050.0) / 1050.0, abs=1e-12)


#: Member 1 of the tail scenario: realized 03-01 .. 03-09 inside its window [01-01, 03-10).
M1_TAIL = {
    "2026-03-01": 0.010, "2026-03-02": 0.0, "2026-03-03": 0.0, "2026-03-04": 0.0,
    "2026-03-05": 0.001, "2026-03-06": 0.002, "2026-03-07": 0.003, "2026-03-08": -0.001,
    "2026-03-09": 0.004,
}
M2_TAIL = {"2026-03-10": 0.005, "2026-03-11": -0.002}


@pytest.mark.asyncio
async def test_a_closed_window_keeps_the_members_realized_days_after_its_last_mark() -> None:
    """WR-03. Member 1's window [01-01, 03-10) has closed (the run labels 03-11). Its key has marks
    on 03-03 (NAV 1010.0, wallet 1000.0) and 03-04 (1020.1) and none after: a mark on 03-05 ..
    03-09 was refused (an option held, a read failure). No later in-window mark will ever exist
    to cover those five days, and Pitfall 7 dropped their realized rows, so the stitch 0.0-filled
    them and the member's real P&L (0.001, 0.002, 0.003, -0.001, 0.004) left the composite for
    good. They are kept, as the allocated member's W2 tail does, with the last mark's open profit
    reversed on the first of them (D-24): the 03-04 mark booked its 20.1 of open profit, so
    03-05's growth factor is taken on the marked level, 1.001 * 1000 / 1020.1 - 1."""
    marks = [stored("2026-03-03", 1010.0, open_pnl=10.0), stored("2026-03-04", 1020.1, open_pnl=20.1)]
    run = await run_ccxt_composite(
        windows=_TWO_MEMBERS_MARCH_10,
        series=[M1_TAIL, M2_TAIL],
        marks={"key-1": marks},
        now=dt.datetime(2026, 3, 12, 0, 10, 30, tzinfo=dt.timezone.utc),
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    rows = run.csv_rows()
    assert rows["2026-03-03"] == pytest.approx(0.01, abs=1e-12)
    assert rows["2026-03-04"] == pytest.approx((1020.1 - 1010.0) / 1010.0, abs=1e-12)
    assert rows["2026-03-05"] == pytest.approx(1.001 * 1000.0 / 1020.1 - 1.0, abs=1e-12)
    for day in ("2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"):
        assert rows[day] == M1_TAIL[day], f"{day} lost its realized return"
    assert run.flags()["gap_day_count"] == 0

    still_open = await run_ccxt_composite(
        windows=_TWO_MEMBERS_MARCH_10,
        series=[M1_TAIL, M2_TAIL],
        marks={"key-1": marks},
        now=dt.datetime(2026, 3, 10, 0, 10, 30, tzinfo=dt.timezone.utc),
    )
    assert still_open.result.outcome == DispatchOutcome.DONE, still_open.result.error_message
    assert "2026-03-06" not in still_open.csv_rows(), (
        "while the window can still receive a mark (this run labels its last day, 03-09) the "
        "next mark's return covers those days"
    )


@pytest.mark.asyncio
async def test_marks_dated_after_a_closed_window_are_not_applied() -> None:
    """Member 1's window closed on 03-01. A mark of its key dated 03-06 can change nothing that
    window shows, so it is not applied and cannot refuse the composite: here
    the mark's wallet would give the apply a nonpositive base (-90.0) and a mark that WAS applied
    would stop the composite. Member 1's rows are its series verbatim."""
    run = await run_ccxt_composite(
        windows=_TWO_MEMBERS, series=[M1_FULL, M2_FULL],
        marks={"key-1": [stored("2026-03-06", 1050.0, open_pnl=1140.0)]},
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    assert run.csv_rows() == {**M1_FULL, **M2_FULL}
    assert "marks_since" not in run.flags()


def test_composite_mark_summary_reads_each_member_inside_its_window() -> None:
    """Pure. A member's covered day, gap day and mark day OUTSIDE its half-open
    window are not the composite's: a covered day outside every window would hide a real
    inter-member hole. Member 1 is windowed [2026-03-01, 2026-03-10), member 2 [2026-03-10, open)."""
    from services.job_worker import _composite_mark_summary

    def marked(levels: list[str], covered: list[str], gaps: list[str]) -> MarkedSeries:
        return MarkedSeries(
            returns=pd.Series(dtype="float64"), marks_since=levels[0],
            mark_gap_days=tuple(gaps), flow_moves={}, held_out_flow_days=(),
            marked_levels={d: 1.0 for d in levels}, writer_day_pnl={}, terminal=(levels[-1], 1.0),
            covered_from=covered[0] if covered else None, covered_days=tuple(covered),
        )

    windows = {1: ("2026-03-01", "2026-03-10"), 2: ("2026-03-10", None)}
    applied = {
        # marks 02-27, 03-02, 03-12 (02-27 precedes the window; 03-12 follows it); covered and gap
        # days on both sides of the window end.
        1: marked(
            ["2026-02-27", "2026-03-02", "2026-03-12"],
            ["2026-02-28", "2026-03-01", "2026-03-09", "2026-03-10", "2026-03-11"],
            ["2026-02-28", "2026-03-01", "2026-03-09", "2026-03-10", "2026-03-11"],
        ),
        2: marked(["2026-03-12"], ["2026-03-11"], ["2026-03-11"]),
    }
    summary = _composite_mark_summary(applied, windows)
    # Member 1 inside [03-01, 03-10): 03-01, 03-09. Member 2 inside [03-10, open): 03-11.
    assert summary.covered_days == ("2026-03-01", "2026-03-09", "2026-03-11")
    assert summary.mark_gap_days == ("2026-03-01", "2026-03-09", "2026-03-11")
    # The earliest mark day inside its own window: 02-27 precedes member 1's window, so 03-02.
    assert summary.marks_since == "2026-03-02"
    empty = _composite_mark_summary({}, windows)
    assert empty.covered_days == () and empty.marks_since is None


@pytest.mark.asyncio
async def test_a_position_closed_in_the_tail_nets_to_its_true_realized_result() -> None:
    """D-24, the invariant. Member 1's wallet is 1000.0 at the first mark's base. The 03-03 and 03-04
    marks (NAV 1010.0, 1020.1) book 20.1 of open profit on a position; the window closes at 03-10,
    marks 03-05 .. 03-09 are refused, and the position is closed flat on 03-05: the realized series
    shows the wallet rising 1000.0 -> 1020.1 that day, r = 0.0201. The member's true result is
    1020.1 / 1000.0 - 1 = 2.01 percent. Booking the tail row verbatim counts the 20.1 twice
    (1.0201 * 1.0201 - 1 = 4.06 percent); with the open profit reversed on the first tail row the
    compounded marked rows plus the tail equal the truth. A position still open at the window end
    (a flat realized day) loses its unrealized profit, as before the phase: 1.0201 * (1000 /
    1020.1) - 1 = 0."""
    marks = [stored("2026-03-03", 1010.0, open_pnl=10.0), stored("2026-03-04", 1020.1, open_pnl=20.1)]

    def tail_series(day_0305: float) -> dict[str, float]:
        return {**M1_TAIL, "2026-03-05": day_0305, "2026-03-06": 0.0, "2026-03-07": 0.0,
                "2026-03-08": 0.0, "2026-03-09": 0.0}

    async def member_total(day_0305: float) -> float:
        run = await run_ccxt_composite(
            windows=_TWO_MEMBERS_MARCH_10, series=[tail_series(day_0305), M2_TAIL],
            marks={"key-1": marks}, now=dt.datetime(2026, 3, 12, 0, 10, 30, tzinfo=dt.timezone.utc),
        )
        assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
        rows = run.csv_rows()
        total = 1.0
        for day in ("2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07",
                    "2026-03-08", "2026-03-09"):
            total *= 1.0 + rows[day]
        return total - 1.0

    assert await member_total(1020.1 / 1000.0 - 1.0) == pytest.approx(1020.1 / 1000.0 - 1.0, abs=1e-12)
    assert await member_total(0.0) == pytest.approx(0.0, abs=1e-12)


@pytest.mark.asyncio
async def test_a_composite_names_where_an_open_member_stops_getting_marks() -> None:
    """SFH round 2 N2. Member 2's window is open and its key's marks stop at 03-07 (a refusal
    every night since): the run on 03-10 labels 03-09, so its rows stop after 03-07, the stitch
    0.0-fills 03-08 and 03-09, and nothing said so. The composite flag
    ``marks_trailing_since`` is the first of those days, 2026-03-08. With a mark on the label day
    it is absent; a stale value from an earlier stitch is popped; a member whose window has CLOSED
    keeps its realized tail (D-24) and never trails."""
    now = dt.datetime(2026, 3, 10, 0, 10, 30, tzinfo=dt.timezone.utc)
    stopped = await run_ccxt_composite(
        windows=_TWO_MEMBERS, series=[M1_FULL, M2_FULL], marks={"key-2": MARKS_KEY2[:2]}, now=now,
    )
    assert stopped.result.outcome == DispatchOutcome.DONE, stopped.result.error_message
    assert stopped.flags()["marks_trailing_since"] == "2026-03-08"
    head = stopped.headline()
    assert head is not None and head["computation_status"] == "complete", "a note, never a warning"

    current = await run_ccxt_composite(
        windows=_TWO_MEMBERS, series=[M1_FULL, M2_FULL], marks={"key-2": MARKS_KEY2}, now=now,
        existing_flags={"marks_trailing_since": "2026-03-01"},
    )
    assert current.result.outcome == DispatchOutcome.DONE, current.result.error_message
    assert "marks_trailing_since" not in current.flags(), "the stale value was popped"

    closed = await run_ccxt_composite(
        windows=_TWO_MEMBERS_MARCH_10, series=[M1_TAIL, M2_TAIL],
        marks={"key-1": [stored("2026-03-03", 1010.0, open_pnl=10.0)]},
        now=dt.datetime(2026, 3, 12, 0, 10, 30, tzinfo=dt.timezone.utc),
    )
    assert closed.result.outcome == DispatchOutcome.DONE, closed.result.error_message
    assert "marks_trailing_since" not in closed.flags()
