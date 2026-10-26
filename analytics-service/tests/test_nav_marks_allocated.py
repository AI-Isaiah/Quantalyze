"""Phase 167.2.1.1.1 NAVMTM plan 16 - allocated-capital strategies follow their key's marked NAV (SC-2, SC-3, D-14).

What these pin, and why each can fail
-------------------------------------
D-14 (founder 2026-10-26, "Apply marks to them too"): from its first mark, an allocated-capital
strategy's returns follow its key's marked NAV, like every other strategy. The allocated returns
path exists only where ``combine_native_ledger`` takes it: a Deribit strategy with a
returns_denominator_config. Its returns are P&L over SCHEDULED capital, not NAV changes, so the
base the first mark is measured against cannot be rolled back through them. It is rolled by
the day P&L and the flows of the NAV TWIN (plan 13), the same crawl's ledger with the net-extraction
spot legs kept (``roll_basis="day_pnl"``, plan 03). Every other venue with a config returns NAV
changes and takes plan 07's returns roll (``test_nav_marks_derive_apply.py``).

The module runs the REAL derive (``run_derive_broker_dailies_job``) over plan 07's in-memory
``StrategyDb`` (a marks table and a ``csv_daily_returns`` that records every write and delete).
Most tests mock the three ledger helpers (``native_ledger_realized_terminal``, ``_day_pnl`` and
``_composed_flows``) so that each returns the literals typed beside the test, and so that the
TWIN ledger and the ALLOCATED ledger answer differently: a derive that takes its base from the
wrong ledger then fails by name. ``test_the_roll_*_on_a_currencys_*_activity_day`` runs the
REAL builder, the REAL allocated combiner and the REAL helpers over a faked crawl instead
(plan 13's stated limit).

Every expected number is a literal typed beside its arithmetic. The oracles are the stored
marks, the fake ledger and the test's own arithmetic, never ``apply_marks`` or the derive.

The derive's own clock is frozen at 00:10:30Z of the day after the label day it marks. The first
writer of a day's mark wins (D-06), so a test seeds the labelled day's mark itself and controls
every mark the apply sees.
"""
from __future__ import annotations

import dataclasses
import datetime as dt
import logging
from contextlib import ExitStack
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services import deribit_ingest as di
from services.broker_dailies import (
    combine_native_ledger as REAL_COMBINE,
    native_ledger_composed_flows as REAL_FLOWS,
    native_ledger_day_pnl as REAL_DAY_PNL,
    native_ledger_realized_terminal as REAL_TERMINAL,
)
from services.deribit_ingest import DeribitNativeAccountState
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from tests.test_derive_broker_dailies_dualmode import _cash_series_payload  # noqa: F401
from tests.test_deribit_ingest import _NativeAnchorStub, _patch_pipeline
from tests.test_mtm_single_key import (
    _apply as _drb_apply,
    _base_patches,
    _ctx,
    _ledger_meta,
    _report,
    _stub_native_ledger,
)
from tests.test_nav_marks_derive_apply import (  # noqa: F401  (route_csv wraps route_marks)
    KEY,
    STRATEGY,
    USER,
    StrategyDb,
    assert_refusal_cost_nothing,
    at_0010,
    failed_stamps,
    prestamp,
    route_csv,
    seed_mark,
    series,
)
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    _real_marks_writer,
    route_marks,
)

#: The real builder, captured at import, before any test patches ``services.deribit_ingest``.
REAL_BUILD = di.build_deribit_native_ledger

# --------------------------------------------------------------------------------------
# The fixtures
# --------------------------------------------------------------------------------------

#: The allocated-capital returns the combiner yields for the strategy: one row per day
#: 2026-03-01 .. 2026-03-07. The numbers are arbitrary; the apply keeps every day before the
#: first mark verbatim (L1) and the tests assert that it does.
ALLOCATED = {
    "2026-03-01": 0.010, "2026-03-02": -0.004, "2026-03-03": 0.002, "2026-03-04": 0.006,
    "2026-03-05": -0.001, "2026-03-06": 0.003, "2026-03-07": 0.0007,
}
PRE_MARK = {d: v for d, v in ALLOCATED.items() if d <= "2026-03-05"}

MARKS = {"2026-03-06": 1900.0, "2026-03-07": 1910.0}


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
#: The ALLOCATED ledger's levels: the same terminal and flows but a 03-06 P&L 150.0 larger,
#: the net-extraction legs the allocated ledger drops (Bug B). A base rolled from THESE is
#: L(03-05) = 2000.0 - 5.0 - 170.0 - 100.0 = 1725.0, which is wrong.
ALLOC = Levels(("2026-03-07", 2000.0), {"2026-03-06": 170.0, "2026-03-07": 5.0}, {"2026-03-06": 100.0})

TWIN_BASE = 1875.0
ALLOC_BASE = 1725.0


def config(
    *, first: str = "2026-03-01", mandate_end: str | None = None, cumulative: str = "simple"
) -> dict[str, Any]:
    cfg: dict[str, Any] = {
        "denominator": "allocated_capital",
        "pnl_basis": "cash_settlement",
        "metrics_basis": "calendar_day",
        "cumulative_method": cumulative,
        "capital_schedule": [{"effective_from": first, "capital_usd": 1000.0}],
    }
    if mandate_end is not None:
        cfg["mandate_end"] = mandate_end
    return cfg


@dataclass
class Run:
    result: Any
    capture: dict[str, Any]
    db: StrategyDb
    #: one entry per ``build_deribit_native_ledger`` call: the ``nav_twin`` it was given
    builds: list[dict[str, Any]] = field(default_factory=list)

    @property
    def rows(self) -> dict[str, float]:
        return self.db.rows()


def _levels_patches(alloc: Any, twin: Any, alloc_levels: Levels, twin_levels: Levels) -> list[Any]:
    """The three helpers answer by LEDGER IDENTITY, so a base taken from the wrong ledger is a
    different number, not the same one by coincidence."""

    def _levels(ledger: Any) -> Levels:
        return twin_levels if ledger is twin else alloc_levels

    def _terminal(ledger: Any, _indexable: Any) -> Any:
        t = _levels(ledger).terminal
        return None if t is None else (pd.Timestamp(t[0]), t[1])

    def _pnl(ledger: Any, _indexable: Any) -> pd.Series:
        return series(_levels(ledger).pnl)

    def _flows(ledger: Any, _indexable: Any) -> pd.Series:
        return series(_levels(ledger).flows)

    return [
        patch("services.broker_dailies.native_ledger_realized_terminal", new=MagicMock(side_effect=_terminal)),
        patch("services.broker_dailies.native_ledger_day_pnl", new=MagicMock(side_effect=_pnl)),
        patch("services.broker_dailies.native_ledger_composed_flows", new=MagicMock(side_effect=_flows)),
    ]


async def derive_allocated(
    db: StrategyDb,
    *,
    cfg: dict[str, Any],
    now_day: str,
    allocated: dict[str, float] | None = None,
    twin: Levels | None = TWIN,
    alloc: Levels = ALLOC,
    twin_error: str | None = None,
    extra_patches: list[Any] | None = None,
    balance_error: bool = False,
) -> Run:
    """Run the real strategy-mode derive for an allocated-capital Deribit strategy.

    ``twin`` are the NAV twin's levels (``None``: no twin is attached, as when the build failed
    and ``twin_error`` names the class). ``now_day`` is the day the derive runs on (00:10:30Z), so
    it labels the day before."""
    ctx, capture = _ctx(strategy_row={
        "id": STRATEGY, "user_id": USER, "asset_class": "crypto", "returns_denominator_config": cfg,
    })
    ctx.key_row = {"id": KEY, "user_id": USER, "exchange": "deribit"}
    route_csv(route_marks(ctx, db), db)
    alloc_ledger = _stub_native_ledger()
    twin_ledger = dataclasses.replace(alloc_ledger)
    builds: list[dict[str, Any]] = []

    async def _build(exchange: Any, *, account_state: Any, pnl_basis: str,
                     exclude_spot_extraction: bool, nav_twin: bool = False) -> Any:
        builds.append({"nav_twin": nav_twin, "exclude_spot_extraction": exclude_spot_extraction})
        report = _report(has_option_activity=False)
        if nav_twin and twin is not None:
            report.nav_twin_ledger = twin_ledger
        if nav_twin and twin_error is not None:
            report.nav_twin_error = twin_error
        return alloc_ledger, report

    state = DeribitNativeAccountState(
        native_equity={"BTC": 0.02}, native_upnl={"BTC": 0.001},
        collapsed_equity_usd=2100.0, collapsed_upnl_usd=100.0,
        balance_error=balance_error, upnl_unreadable=False, native_options_value={},
    )
    returns = series(ALLOCATED if allocated is None else allocated)
    patches = _base_patches(
        ctx, key_mode=False,
        ledger_mock=AsyncMock(side_effect=_build),
        combine_mock=MagicMock(return_value=(returns, _ledger_meta())),
        state_spy=AsyncMock(return_value=state),
    ) + [
        patch("services.job_worker._utc_now", new=MagicMock(return_value=at_0010(now_day))),
        *_levels_patches(alloc_ledger, twin_ledger, alloc, twin if twin is not None else TWIN),
        *(extra_patches or []),
    ]
    with _drb_apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j-alloc", "kind": "derive_broker_dailies", "strategy_id": STRATEGY}
        )
    return Run(result, capture, db, builds)


#: The wallet each stored mark carries: the twin's realized level on that day (terminal 2000.0 on
#: 03-07, less 03-07's day P&L 5.0 on 03-06). Only the FIRST mark's wallet is read by the apply
#: (plan 03 rule 3), where it is what the base is rolled back from.
TWIN_WALLET = {"2026-03-06": 1995.0, "2026-03-07": 2000.0}


def seeded(marks: dict[str, float], *, first_wallet: float | None = None) -> StrategyDb:
    """``first_wallet`` overrides the wallet of the FIRST mark (the only one the apply reads)."""
    db = StrategyDb()
    for k, (day, nav) in enumerate(marks.items()):
        wallet = first_wallet if (k == 0 and first_wallet is not None) else TWIN_WALLET.get(
            day, nav - 10.0
        )
        seed_mark(db, day, nav, venue="deribit", open_pnl=nav - wallet, native_unit=None)
    return db


# --------------------------------------------------------------------------------------
# Task 1 - the tracer
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_allocated_strategy_follows_marked_nav_from_the_first_mark() -> None:
    """Allocated returns 03-01..03-07, a NAV twin whose realized terminal is (03-07, 2000.0) with
    day P&L {03-06: 20.0, 03-07: 5.0} and composed flows {03-06: 100.0}, stored marks 03-06
    (1900.0) and 03-07 (1910.0), an open mandate.

    The base is L(03-05) = 2000.0 - 5.0 - 20.0 - 100.0 = 1875.0. Rows 03-01..03-05 are the
    allocated returns exactly (L1); r(03-06) = (1900.0 - 1875.0 - 100.0) / 1875.0 = -0.04 (the
    deposit is in the numerator) and r(03-07) = (1910.0 - 1900.0) / 1900.0. The allocated 03-06
    and 03-07 rows (0.003 and 0.0007) are NOT written: from the first mark the series is the
    marked NAV's (Pitfall 7)."""
    run = await derive_allocated(seeded(MARKS), cfg=config(), now_day="2026-03-08")
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    rows = run.rows
    assert {d: v for d, v in rows.items() if d < "2026-03-06"} == PRE_MARK
    assert rows["2026-03-06"] == pytest.approx((1900.0 - 1875.0 - 100.0) / 1875.0, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx((1910.0 - 1900.0) / 1900.0, abs=1e-12)
    assert rows["2026-03-06"] == pytest.approx(-0.04, abs=1e-12)
    assert sorted(rows) == [*PRE_MARK, "2026-03-06", "2026-03-07"]
    flags = prestamp(run.capture)
    assert flags["marks_since"] == "2026-03-06"
    assert flags["marks_covered_from"] == "2026-03-06"
    assert [b["nav_twin"] for b in run.builds] == [True], "the cash pass asked for the twin"
    assert run.builds[0]["exclude_spot_extraction"] is True


@pytest.mark.asyncio
async def test_no_marks_closed_mandate_builds_no_twin() -> None:
    """A mandate that ended 2026-02-15, before the day this derive labels (03-07), with no stored
    mark: no twin is requested (the spy sees ``nav_twin`` False), and the persisted rows and the
    prestamp are exactly what the derive writes when it reads no marks at all."""
    allocated = {"2026-02-10": 0.01, "2026-02-11": -0.02, "2026-02-12": 0.005}
    cfg = config(first="2026-01-01", mandate_end="2026-02-15")
    run = await derive_allocated(StrategyDb(), cfg=cfg, now_day="2026-03-08", allocated=allocated)
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    assert [b["nav_twin"] for b in run.builds] == [False]
    base = await derive_allocated(
        StrategyDb(), cfg=cfg, now_day="2026-03-08", allocated=allocated,
        extra_patches=[patch("services.job_worker.read_key_marks", new=MagicMock(return_value=[]))],
    )
    assert run.rows == base.rows == allocated
    assert prestamp(run.capture) == prestamp(base.capture)
    assert "marks_since" not in prestamp(run.capture)


# --------------------------------------------------------------------------------------
# Task 2 - the base is the twin's, the mandate window and its tail (W2), the simple-sum rule
# --------------------------------------------------------------------------------------

R_0306 = (1900.0 - TWIN_BASE - 100.0) / TWIN_BASE  # -0.04
R_0307 = (1910.0 - 1900.0) / 1900.0
#: D-24. The W2 tail row 03-08 is the allocated row 0.0123 with the last mark's open profit
#: reversed: that mark (03-07) has NAV 1910.0 and open profit 1910.0 - 2000.0 = -90.0.
R_TAIL_0308 = 1.0123 * (1910.0 + 90.0) / 1910.0 - 1.0


@pytest.mark.asyncio
async def test_allocated_base_comes_from_the_nav_twin() -> None:
    """Bug B (T-167.2.1.1.1-44). The allocated ledger dropped the net-extraction legs, so its day
    P&L on 03-06 is 150.0 larger than the twin's (ALLOC, see the fixtures) and a net-extraction
    pair lies inside the roll span (03-05, 03-07]. The twin's base is
    L(03-05) = 2000.0 - 5.0 - 20.0 - 100.0 = 1875.0, so r(03-06) = (1900.0 - 1875.0 - 100.0) /
    1875.0 = -0.04. A base taken from the allocated ledger's levels is
    2000.0 - 5.0 - 170.0 - 100.0 = 1725.0 and gives (1900.0 - 1725.0 - 100.0) / 1725.0, which is
    NOT what is persisted."""
    run = await derive_allocated(seeded(MARKS), cfg=config(), now_day="2026-03-08")
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    from_allocated_ledger = (1900.0 - ALLOC_BASE - 100.0) / ALLOC_BASE
    assert run.rows["2026-03-06"] == pytest.approx(R_0306, abs=1e-12)
    assert run.rows["2026-03-06"] != pytest.approx(from_allocated_ledger, abs=1e-6)
    assert run.rows["2026-03-07"] == pytest.approx(R_0307, abs=1e-12)


@pytest.mark.asyncio
async def test_marks_after_mandate_end_are_not_applied(caplog: pytest.LogCaptureFixture) -> None:
    """MEDIUM-2 (T-167.2.1.1.1-46). Marks on 03-06, 03-07 and 03-08.

    mandate_end 2026-03-07 (a marked day): only 03-06 and 03-07 apply, the 03-08 mark does not,
    and no row exists after 03-07. mandate_end 2026-03-05: no mark is inside the window, so the
    series is the allocated one unchanged, nothing says marks began, no twin was asked for, and
    one log line names the 3 marks outside it. The derive runs on 03-09, so it labels 03-08 (a
    seeded mark) and the window is closed in both cases."""
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    marks = {**MARKS, "2026-03-08": 1920.0}

    inside = await derive_allocated(
        seeded(marks), cfg=config(mandate_end="2026-03-07"), now_day="2026-03-09"
    )
    assert inside.result.outcome == DispatchOutcome.DONE, inside.result.error_message
    assert inside.rows == {**PRE_MARK, "2026-03-06": pytest.approx(R_0306), "2026-03-07": pytest.approx(R_0307)}
    assert max(inside.rows) == "2026-03-07", "no row after mandate_end"
    assert prestamp(inside.capture)["marks_since"] == "2026-03-06"

    caplog.clear()
    before = await derive_allocated(
        seeded(marks), cfg=config(mandate_end="2026-03-05"), now_day="2026-03-09",
        allocated=PRE_MARK,
    )
    assert before.result.outcome == DispatchOutcome.DONE, before.result.error_message
    assert before.rows == PRE_MARK
    assert "marks_since" not in prestamp(before.capture)
    assert [b["nav_twin"] for b in before.builds] == [False]
    outside = [r.getMessage() for r in caplog.records if "outside the mandate window" in r.getMessage()]
    assert len(outside) == 1 and "outside=3" in outside[0] and "inside=0" in outside[0], outside


@pytest.mark.asyncio
async def test_mandate_end_on_an_unmarked_day_keeps_the_tail() -> None:
    """W2 (T-167.2.1.1.1-55). mandate_end 2026-03-08 is not a marked day: the marks on 03-06 and
    03-07 are inside the window and the mark on 03-09 is outside it. The derive runs on 03-10, so
    it labels 03-09 and the window has CLOSED: no later in-window mark will ever cover 03-08, so
    its allocated row (0.0123) is kept, with the 03-07 mark's open profit reversed on it (D-24:
    that mark has NAV 1910.0 and open profit -90.0, so the row is 1.0123 * 2000 / 1910 - 1),
    nothing is invented for 03-09, and rows 03-06 and 03-07 are the marked returns.

    While the window is still OPEN (the derive runs on 03-08 and labels 03-07, before
    mandate_end) the next mark covers 03-08, so no row exists after the last mark."""
    allocated = {**ALLOCATED, "2026-03-08": 0.0123}
    closed = await derive_allocated(
        seeded({**MARKS, "2026-03-09": 1920.0}), cfg=config(mandate_end="2026-03-08"),
        now_day="2026-03-10", allocated=allocated,
    )
    assert closed.result.outcome == DispatchOutcome.DONE, closed.result.error_message
    assert closed.rows == {
        **PRE_MARK, "2026-03-06": pytest.approx(R_0306), "2026-03-07": pytest.approx(R_0307),
        "2026-03-08": pytest.approx(R_TAIL_0308),
    }
    assert "2026-03-09" not in closed.rows

    still_open = await derive_allocated(
        seeded(MARKS), cfg=config(mandate_end="2026-03-08"), now_day="2026-03-08",
        allocated=allocated,
    )
    assert still_open.result.outcome == DispatchOutcome.DONE, still_open.result.error_message
    assert max(still_open.rows) == "2026-03-07"


@pytest.mark.asyncio
async def test_simple_sum_rule() -> None:
    """The simple-sum rule (NAVMTM D-14), cumulative_method 'simple'. The persisted rows are the
    five allocated rows before the first mark (their sum is 0.010 - 0.004 + 0.002 + 0.006 - 0.001
    = 0.013), the two marked returns (-0.04 and 10 / 1900) and the W2 tail row (``R_TAIL_0308``,
    the allocated 0.0123 with the last mark's open profit reversed, D-24). The
    cash_settlement series' cumulative return is the SUM of every one of those rows,
    0.013 - 0.04 + 10 / 1900 + ``R_TAIL_0308``, and it differs from the compounded figure on the same
    rows. The derive's scalar cache is read off ``derive_basis_series``'s own result: the derive
    persists no scalar, the published figure is the runner's recompute from the same rows."""
    import services.basis_series as basis_series

    seen: list[Any] = []
    real = basis_series.derive_basis_series

    def _spy(*args: Any, **kwargs: Any) -> Any:
        result = real(*args, **kwargs)
        seen.append((kwargs, result))
        return result

    allocated = {**ALLOCATED, "2026-03-08": 0.0123}
    run = await derive_allocated(
        seeded({**MARKS, "2026-03-09": 1920.0}), cfg=config(mandate_end="2026-03-08"),
        now_day="2026-03-10", allocated=allocated,
        extra_patches=[patch("services.basis_series.derive_basis_series", new=_spy)],
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    kwargs, result = seen[0]
    assert kwargs["cumulative_method"] == "simple"
    persisted = run.rows
    assert sorted(persisted) == [*PRE_MARK, "2026-03-06", "2026-03-07", "2026-03-08"]
    summed = 0.013 + (-0.04) + 10.0 / 1900.0 + R_TAIL_0308
    compounded = 1.0
    for value in persisted.values():
        compounded *= 1.0 + value
    compounded -= 1.0
    assert result.metrics_json["cumulative_return"] == pytest.approx(summed, abs=1e-12)
    assert sum(persisted.values()) == pytest.approx(summed, abs=1e-12)
    assert abs(compounded - summed) > 1e-5, "the fixture must tell the two rules apart"
    assert result.metrics_json["cumulative_return"] != pytest.approx(compounded, abs=1e-6)


# --------------------------------------------------------------------------------------
# Task 3 - W1 both ways, the L3 refusals
# --------------------------------------------------------------------------------------

TOKEN = "mark_allocated_nav_unreconciled"


@pytest.mark.asyncio
async def test_twin_unbuildable_without_marks_continues(caplog: pytest.LogCaptureFixture) -> None:
    """W1 (a), T-167.2.1.1.1-56. An open mandate, no stored mark in the window, this derive's
    own mark refused (its balance read failed) and the twin could not be built
    (``nav_twin_error`` 'LedgerValuationError'). There is nothing to apply, so the derive
    completes exactly as it did before marks existed: the same rows and prestamp as a derive that
    reads no marks, and ONE log line names ``nav_twin_unbuildable`` and the class."""
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    run = await derive_allocated(
        StrategyDb(), cfg=config(), now_day="2026-03-08", twin=None,
        twin_error="LedgerValuationError", balance_error=True,
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    assert [b["nav_twin"] for b in run.builds] == [True], "the twin was asked for and failed"
    assert run.db.marks == {}, "this derive's own mark was refused"
    lines = [r.getMessage() for r in caplog.records if "nav_twin_unbuildable" in r.getMessage()]
    assert len(lines) == 1 and "LedgerValuationError" in lines[0], lines
    base = await derive_allocated(
        StrategyDb(), cfg=config(), now_day="2026-03-08", twin=None, balance_error=True,
        extra_patches=[patch("services.job_worker.read_key_marks", new=MagicMock(return_value=[]))],
    )
    assert run.rows == base.rows == ALLOCATED
    assert prestamp(run.capture) == prestamp(base.capture)


@pytest.mark.asyncio
async def test_twin_unbuildable_with_marks_refuses(caplog: pytest.LogCaptureFixture) -> None:
    """W1 (b), L3, T-167.2.1.1.1-48. The same twin failure with a stored in-window mark to apply:
    no csv row is written or deleted (the table holds a stale row a derive that kept going would
    delete), no prestamp, ONE failed stamp that does not heal the series and whose detail is the
    token only, and FAILED permanent naming ``mark_allocated_nav_unreconciled``."""
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    db = seeded(MARKS)
    for day, value in ALLOCATED.items():
        db.csv[(STRATEGY, day)] = value
    db.csv[(STRATEGY, "2026-03-08")] = 0.5
    before = dict(db.csv)
    run = await derive_allocated(
        db, cfg=config(), now_day="2026-03-08", twin=None, twin_error="LedgerValuationError"
    )
    assert run.result.outcome == DispatchOutcome.FAILED
    assert run.result.error_kind == "permanent"
    assert TOKEN in run.result.error_message
    assert_refusal_cost_nothing(db, run.capture, before, TOKEN, caplog)


@pytest.mark.asyncio
async def test_twin_section5_refusal_writes_nothing(caplog: pytest.LogCaptureFixture) -> None:
    """L3. The twin exists but its ``native_ledger_day_pnl`` raises
    ``InceptionReconciliationError`` (the twin cannot pass section 5 either). With a stored
    in-window mark that is the same named refusal and the same nothing-written."""
    from services.native_nav import InceptionReconciliationError

    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    db = seeded(MARKS)
    for day, value in ALLOCATED.items():
        db.csv[(STRATEGY, day)] = value
    before = dict(db.csv)

    def _breach(_ledger: Any, _indexable: Any) -> Any:
        raise InceptionReconciliationError(currencies=["BTC"], venue="deribit", breach_ratio=3.0)

    run = await derive_allocated(
        db, cfg=config(), now_day="2026-03-08",
        extra_patches=[patch("services.broker_dailies.native_ledger_day_pnl", new=_breach)],
    )
    assert run.result.outcome == DispatchOutcome.FAILED
    assert run.result.error_kind == "permanent"
    assert TOKEN in run.result.error_message
    assert_refusal_cost_nothing(db, run.capture, before, TOKEN, caplog)


@pytest.mark.asyncio
async def test_a_nonpositive_allocated_base_is_a_gap_not_a_failed_derive() -> None:
    """CR-02. A first mark whose wallet is 95.0 gives the base L(03-05) = 95.0 - 20.0 - 100.0 =
    -25.0, which is not positive. 03-06 has no return of its own (a gap), the derive is DONE, and
    03-07 is measured from the stored 1900.0: (1910 - 1900) / 1900."""
    db = seeded(MARKS, first_wallet=95.0)
    run = await derive_allocated(db, cfg=config(), now_day="2026-03-08")
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    assert failed_stamps(run.capture) == []
    assert "2026-03-06" not in run.rows
    assert run.rows["2026-03-07"] == pytest.approx(R_0307, abs=1e-12)


# --------------------------------------------------------------------------------------
# Plan 13's stated limit: an extraction on a currency's FIRST or LAST activity day
# --------------------------------------------------------------------------------------
#
# Plan 13 reuses the allocated ledger's dense marks for the twin. Those marks are built from the
# ALLOCATED native_pnl span (the extraction legs are not in it), the flows and the terminal
# balance, so an extraction day can lie outside the span the marks were planned for. These tests
# run the REAL builder over a faked crawl, the REAL allocated combiner and the REAL helpers. The
# outcome must be one of two things, never a third: the roll VALUES the day (and the persisted
# return is the one this module computes by hand from the raw rows), or it REFUSES BY NAME and
# writes nothing (L3). It must never misvalue the day silently.
#
# The account: a 2.0 BTC deposit, a -0.01 BTC perp fee on 03-05 (a settlement row carrying a
# 60,000 index), and a net-extraction BTC_USDC sale of BTC for USDC. BTC is 60,000 on every
# day, unless a case says otherwise. With the legs kept, NAV(03-05) = 1.99 * 60,000 = 119,400.


def _ms(day: int, hour: int = 12) -> int:
    return int(dt.datetime(2026, 3, day, hour, tzinfo=dt.timezone.utc).timestamp() * 1000)


def _row(kind: str, currency: str, change: float, day: int, hour: int, **extra: Any) -> dict[str, Any]:
    row: dict[str, Any] = {"type": kind, "currency": currency, "change": change, "timestamp": _ms(day, hour)}
    row.update(extra)
    return row


def _fee_row() -> dict[str, Any]:
    return _row("settlement", "BTC", -0.01, 5, 8, instrument_name="BTC-PERPETUAL", index_price=60000.0)


def _sale(btc: float, usdc: float, day: int) -> list[dict[str, Any]]:
    return [
        _row("trade", "BTC", -btc, day, 10, instrument_name="BTC_USDC"),
        _row("trade", "USDC", usdc, day, 10, instrument_name="BTC_USDC"),
    ]


def _feed(**overrides: float | None) -> dict[str, float]:
    """The delivery-price feed, 60,000 on 03-03..03-08. ``d04=None`` drops 03-04, ``d06=62000.0``
    changes 03-06."""
    feed = {f"2026-03-{d:02d}": 60000.0 for d in range(3, 9)}
    for key, value in overrides.items():
        day = f"2026-03-{int(key[1:]):02d}"
        if value is None:
            del feed[day]
        else:
            feed[day] = value
    return feed


async def derive_real_crawl(
    monkeypatch: pytest.MonkeyPatch,
    db: StrategyDb,
    *,
    rows: list[dict[str, Any]],
    feed: dict[str, float],
    btc_equity: float,
    usdc_equity: float,
    capital_usd: float = 1_000_000.0,
) -> Run:
    """The real strategy-mode derive for an allocated-capital strategy over a faked crawl: the
    real builder (twin on request), the real allocated combiner, the real ledger helpers. Marks
    already stored in ``db`` are the only mark the apply sees (the derive's own is a later day)."""

    async def _paginate(_ex: Any, _scope: str, currency: str, *_a: Any, **_k: Any) -> list[Any]:
        return list(rows) if currency == "BTC" else []

    _patch_pipeline(
        monkeypatch, scopes=[di.Scope("main", None, True)], currencies={"main": ["BTC"]},
        paginate=_paginate,
    )

    async def _delivery(_ex: Any, _currency: str, *, oldest_day: str, sleep: Any) -> dict[str, float]:
        return dict(feed)

    async def _no_perp(_ex: Any, _currency: str, *, oldest_day: str, sleep: Any) -> dict[str, float]:
        return {}

    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _delivery)
    monkeypatch.setattr(di, "fetch_deribit_perp_daily_index", _no_perp)
    monkeypatch.setattr(di, "_today_utc_iso", lambda: "2026-03-08")

    anchor = _NativeAnchorStub(
        summaries=[
            {"currency": "BTC", "equity": btc_equity, "session_upl": 0.0},
            {"currency": "USDC", "equity": usdc_equity, "session_upl": 0.0},
        ],
        index_price={"BTC": 60000.0},
    )
    state = await di.fetch_deribit_native_account_state(anchor)

    async def _build(_exchange: Any, **kwargs: Any) -> Any:
        return await REAL_BUILD(anchor, **kwargs)

    cfg = config()
    cfg["capital_schedule"] = [{"effective_from": "2026-03-01", "capital_usd": capital_usd}]
    ctx, capture = _ctx(strategy_row={
        "id": STRATEGY, "user_id": USER, "asset_class": "crypto", "returns_denominator_config": cfg,
    })
    ctx.key_row = {"id": KEY, "user_id": USER, "exchange": "deribit"}
    route_csv(route_marks(ctx, db), db)
    patches = _base_patches(
        ctx, key_mode=False,
        ledger_mock=AsyncMock(side_effect=_build),
        combine_mock=MagicMock(side_effect=REAL_COMBINE),
        state_spy=AsyncMock(return_value=state),
    ) + [
        patch("services.job_worker._utc_now", new=MagicMock(return_value=at_0010("2026-03-08"))),
        patch("services.broker_dailies.native_ledger_realized_terminal", new=REAL_TERMINAL),
        patch("services.broker_dailies.native_ledger_day_pnl", new=REAL_DAY_PNL),
        patch("services.broker_dailies.native_ledger_composed_flows", new=REAL_FLOWS),
    ]
    with _drb_apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j-real", "kind": "derive_broker_dailies", "strategy_id": STRATEGY}
        )
    return Run(result, capture, db)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "probe", ["last_day_marked", "last_day_unmarked", "last_day_liquidation_unmarked", "last_day_liquidation_marked"]
)
async def test_the_roll_on_a_currencys_last_activity_day(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, probe: str,
) -> None:
    """The extraction (1.0 BTC for 60,000 USDC) is on 03-06, the LAST activity day of BTC and the
    twin's last NAV day, so the realized terminal sits on it. Terminal equity BTC 0.99, USDC
    60,000; stored marks 03-06 and 03-07.

    ``last_day_marked``: 03-06 carries a mark (62,000 in the feed). The twin's NAV(03-06) =
    0.99 * 62,000 + 60,000 = 121,380 and the roll steps back over (03-05, 03-06] to
    NAV(03-05) = 1.99 * 60,000 = 119,400, so with marks 121,380 (03-06) and 122,000 (03-07):
    r(03-06) = (121,380 - 119,400) / 119,400 and r(03-07) = (122,000 - 121,380) / 121,380. The
    row before the first mark is the allocated -0.01 BTC * 60,000 / 1,000,000 = -0.0006.

    ``last_day_unmarked``: the feed has no 03-06 and the extraction rows carry no index. BTC is
    still held (0.99) on 03-06, so the twin REQUIRES that mark: its helpers refuse
    (missing_daily_marks, or the section-5 gate that needs the same day's price) and the derive
    refuses by name, writing nothing. It does not value 03-06 at the 03-05 price.

    ``last_day_liquidation_marked`` and ``_unmarked``: the sale takes ALL of BTC (1.99 for
    119,400 USDC), so BTC is zero after 03-06 and the valuation needs no BTC price that day (the
    USDC proceeds carry the value). With the mark the roll values the day to the same base
    119,400 and the persisted returns are the hand-computed ones (stored marks 120,000 and
    121,000). WITHOUT the mark it still refuses by name: the section-5 gate reads each
    currency's price on its OWN last balance day, an absent one is NaN, and the gate does not
    pass on NaN. The over-refusal is conservative and named; it is never a guessed price."""
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    if probe.startswith("last_day_liquidation"):
        rows = [_row("deposit", "BTC", 2.0, 4, 6), _fee_row(), *_sale(1.99, 119400.0, 6)]
        btc_equity, usdc_equity, marks = 0.0, 119400.0, {"2026-03-06": 120000.0, "2026-03-07": 121000.0}
    else:
        rows = [_row("deposit", "BTC", 2.0, 4, 6), _fee_row(), *_sale(1.0, 60000.0, 6)]
        btc_equity, usdc_equity, marks = 0.99, 60000.0, {"2026-03-06": 121380.0, "2026-03-07": 122000.0}
    valued = probe not in ("last_day_unmarked", "last_day_liquidation_unmarked")
    # The first mark's wallet is the twin's realized NAV on 03-06 (the terminal day): 121,380
    # with the BTC kept, 119,400 once the sale took it all.
    db = seeded(marks, first_wallet=119400.0 if probe.startswith("last_day_liquidation") else 121380.0)
    for day in ("2026-03-04", "2026-03-05"):
        db.csv[(STRATEGY, day)] = 0.25  # a stale realized row for the refusal to leave alone
    before = dict(db.csv)
    run = await derive_real_crawl(
        monkeypatch, db, rows=rows,
        feed=_feed(d06=62000.0 if probe in ("last_day_marked", "last_day_liquidation_marked") else None),
        btc_equity=btc_equity, usdc_equity=usdc_equity,
    )
    if valued:
        assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
        m06, m07 = marks["2026-03-06"], marks["2026-03-07"]
        assert run.rows["2026-03-05"] == pytest.approx(-0.01 * 60000.0 / 1_000_000.0, abs=1e-12)
        assert run.rows["2026-03-06"] == pytest.approx((m06 - 119400.0) / 119400.0, abs=1e-12)
        assert run.rows["2026-03-07"] == pytest.approx((m07 - m06) / m06, abs=1e-12)
    else:
        assert run.result.outcome == DispatchOutcome.FAILED
        assert run.result.error_kind == "permanent"
        assert TOKEN in run.result.error_message
        assert_refusal_cost_nothing(db, run.capture, before, TOKEN, caplog)
        assert any(
            "nav twin not valued (error=" in r.getMessage()
            and ("UnmarkableCurrencyError" in r.getMessage() or "InceptionReconciliationError" in r.getMessage())
            for r in caplog.records
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("probe", ["first_day_marked", "first_day_unmarked"])
async def test_the_roll_on_a_currencys_first_activity_day(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, probe: str,
) -> None:
    """The deposit of 2.0 BTC and the extraction of 1.0 BTC for 60,000 USDC are both on 03-04,
    BTC's FIRST activity day, and nothing of BTC's own allocated P&L is on it (the fee is on
    03-05). Terminal equity BTC 0.99, USDC 60,000, so NAV(03-05) = 119,400 and the realized
    terminal is on 03-05 (before the first mark, 03-06 = 120,000), whence the base 119,400 and
    r(03-06) = (120,000 - 119,400) / 119,400.

    ``first_day_marked``: the feed carries 03-04 (58,000), so the twin values the day: NAV(03-04)
    = 1.0 * 58,000 + 60,000. That value does not move the base (it telescopes out of the roll),
    which is what the equality below shows: only the 03-05 level matters.

    ``first_day_unmarked``: the feed has no 03-04. The deposit is valued at the day's index, the
    SAME source the mark comes from, so a day with no mark is a day whose deposit the BUILDER
    cannot value: it refuses (permanent) before the twin exists, naming the missing index, and
    nothing is written. A first day cannot reach the twin without a mark."""
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    rows = [_row("deposit", "BTC", 2.0, 4, 6), *_sale(1.0, 60000.0, 4), _fee_row()]
    marked = probe == "first_day_marked"
    db = seeded({"2026-03-06": 120000.0, "2026-03-07": 121000.0}, first_wallet=119400.0)
    db.csv[(STRATEGY, "2026-03-05")] = 0.25
    before = dict(db.csv)
    run = await derive_real_crawl(
        monkeypatch, db, rows=rows, feed=_feed(d04=58000.0 if marked else None),
        btc_equity=0.99, usdc_equity=60000.0,
    )
    if marked:
        assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
        assert run.rows["2026-03-05"] == pytest.approx(-0.01 * 60000.0 / 1_000_000.0, abs=1e-12)
        assert run.rows["2026-03-06"] == pytest.approx((120000.0 - 119400.0) / 119400.0, abs=1e-12)
        assert run.rows["2026-03-07"] == pytest.approx((121000.0 - 120000.0) / 120000.0, abs=1e-12)
    else:
        assert run.result.outcome == DispatchOutcome.FAILED
        assert run.result.error_kind == "permanent"
        assert "has no event-time index_price" in run.result.error_message
        assert db.csv == before and db.csv_upserts == [] and db.csv_deletes == []
        assert not any(c[0] == "upsert_strategy_analytics_series_batch" for c in run.capture["rpc_calls"])
