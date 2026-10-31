"""Phase 167.2.1.1.1 NAVMTM gap G-01, fix round 1 (G01-REVIEW, silent-failure hunt).

What these pin, and why each can fail
-------------------------------------
1. Key mode: a writer basis with no realized terminal is a NAMED refusal
   (``mark_writer_terminal_absent``) on the existing nav-marks road, never a bare
   ``AssertionError`` out of the worker.
2. Every D-25/D-26 writer path that has pre-start rows to roll but no writer terminal or basis
   falls back to the mark's wallet (D-27: the fallback stays, measurement first). It must say so:
   one WARNING with a static message and counts only.
3. D-24 as amended 2026-10-31: the first tail row of a closed allocated mandate or composite
   member lands on the WRITER's own level on the last mark day, not on the last mark's wallet.
   The wallet is read hours after the day boundary, so landing on it books those hours twice.
4. D-24 as corrected 2026-11-01 (round-2 CR-01): a flow that rule 10 moved into the last mark is
   inside the mark's NAV but not inside the writer's level, so the first tail row carries it:
   ``r1' = ((1 + r1) * L_writer(last) + placed_into_last) / M_last - 1``. Without the term a
   closing withdrawal reads as a gain and a deposit as a loss. A rolled level that is not finite
   or not above the dust floor falls back to the wallet with one WARNING (silent-failure MEDIUM-1).
5. D-24 as corrected again (round-3 CR-02): ``placed_into_last`` is the amount rule 10 took out of
   the read day (``flow_moves_out``), not the amount counted into the mark. They differ for a flow
   carrying ``amount_prior_day`` (a Deribit BTC or ETH flow priced at its own minute), and the
   tail must land on the writer's level, ``M_last * (1 + r1') == L_writer(last+1) - F_post``.

Oracles are typed beside their arithmetic from each fixture's own numbers.
"""
from __future__ import annotations

import dataclasses
import logging
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from services.external_flows import FlowInstant
from services.job_worker import DispatchOutcome
from tests.test_mt5_derive_branch import (  # noqa: F401  (autouse: clears the terminal registry)
    _reset_mt5_terminal_locks,
)
from tests.test_nav_marks_allocated import (
    MARKS as ALLOCATED_MARKS,
    PRE_MARK,
    R_0306,
    R_0307,
    R_TAIL_0308,
    TWIN,
    Levels,
    config,
    derive_allocated,
    seeded,
)
from tests.test_nav_marks_compose_roundtrip import (
    KEY_DRB,
    KeyDb,
    derive_deribit_key,
    seed_deribit_marks,
)
from tests.test_nav_marks_composite import run_deribit_composite, stored
from tests.test_stitch_composite_job import _stub_ledger
from tests.test_nav_marks_composite_allocated import (
    ALLOCATED as COMPOSITE_ALLOCATED,
    MARKS as COMPOSITE_ALLOCATED_MARKS,
    config as composite_config,
    run_allocated_composite,
)
from tests.test_nav_marks_derive_apply import (
    at_0010,
    run_deribit,
    run_mt5,
    seed_mark,
)
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    _real_marks_writer,
)

LOGGER = "quantalyze.analytics.job_worker"
WALLET_FALLBACK = "first-mark base falls back to the wallet"


def _fallback_lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        r.getMessage() for r in caplog.records
        if r.levelname == "WARNING" and WALLET_FALLBACK in r.getMessage()
    ]


# --------------------------------------------------------------------------------------
# 1. Key mode: no writer terminal beside a writer basis is a named refusal
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_key_mode_writer_basis_without_a_terminal_refuses_by_name(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A Deribit key derive whose ledger answers a day P&L and flows but NO realized terminal.
    The writer's first-mark base cannot be taken, and quietly using the wallet would bring G-01
    back, so the derive refuses on the existing nav-marks road: FAILED, permanent, the token in
    the message, nothing written. It used to raise a bare ``AssertionError`` out of the worker."""
    db = KeyDb()
    seed_deribit_marks(db)
    with caplog.at_level(logging.ERROR, logger=LOGGER):
        result, _capture = await derive_deribit_key(
            db, collapsed_equity=1215.0, collapsed_upnl=215.0, now=at_0010("2026-03-11"),
            no_terminal=True,
        )
    assert result.outcome == DispatchOutcome.FAILED, result.error_message
    assert result.error_kind == "permanent"
    assert result.error_message == (
        "derive_broker_dailies: nav marks refused (mark_writer_terminal_absent)"
    )
    assert any(
        r.levelname == "ERROR" and "reason=mark_writer_terminal_absent" in r.getMessage()
        for r in caplog.records
    ), caplog.text
    assert db.rows(KEY_DRB) == {}


# --------------------------------------------------------------------------------------
# 2. The wallet fallback is named, counts only
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_key_mode_without_a_writer_basis_names_the_wallet_fallback(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Key mode, Deribit: the ledger's day P&L is empty, so the key has no writer basis and its
    first mark is measured from the wallet. The pre-start rows exist (03-01 .. 03-05), so the
    derive says so once, with the site and the row count and nothing else."""
    db = KeyDb()
    seed_deribit_marks(db)
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        await derive_deribit_key(
            db, collapsed_equity=1215.0, collapsed_upnl=215.0, now=at_0010("2026-03-11"),
            day_pnl={},
        )
    lines = _fallback_lines(caplog)
    assert len(lines) == 1, caplog.text
    assert "site=key" in lines[0] and "pre_start_rows=5" in lines[0], lines[0]


@pytest.mark.asyncio
async def test_deribit_strategy_without_a_terminal_names_the_wallet_fallback(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        run = await run_deribit(marked_run_patches=[patch(
            "services.broker_dailies.native_ledger_realized_terminal",
            new=MagicMock(return_value=None),
        )])
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    lines = _fallback_lines(caplog)
    assert len(lines) == 1, caplog.text
    assert "site=strategy_deribit" in lines[0] and "pre_start_rows=5" in lines[0], lines[0]


@pytest.mark.asyncio
async def test_mt5_strategy_without_a_day_pnl_names_the_wallet_fallback(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(
        "services.broker_dailies.mt5_day_pnl",
        lambda *_a, **_kw: pd.Series([], index=pd.DatetimeIndex([]), dtype="float64"),
    )
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        run = await run_mt5(monkeypatch, btc=False)
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    lines = _fallback_lines(caplog)
    assert len(lines) == 1, caplog.text
    assert "site=strategy_mt5" in lines[0], lines[0]


@pytest.mark.asyncio
async def test_allocated_twin_without_a_terminal_names_the_wallet_fallback(
    caplog: pytest.LogCaptureFixture,
) -> None:
    twin = Levels(None, TWIN.pnl, TWIN.flows)
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        run = await derive_allocated(
            seeded(ALLOCATED_MARKS), cfg=config(), now_day="2026-03-08", twin=twin
        )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    lines = _fallback_lines(caplog)
    assert len(lines) == 1, caplog.text
    assert "site=allocated_twin" in lines[0] and "pre_start_rows=5" in lines[0], lines[0]


@pytest.mark.asyncio
async def test_composite_deribit_member_without_a_terminal_names_the_wallet_fallback(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        run, _ctxs = await run_deribit_composite(
            marks={"key-2": [stored("2026-03-06", 1050.0, venue="deribit", open_pnl=50.0)]},
            extra_patches=[patch(
                "services.broker_dailies.native_ledger_realized_terminal",
                new=MagicMock(return_value=None),
            )],
        )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    lines = _fallback_lines(caplog)
    assert len(lines) == 1, caplog.text
    assert "site=composite_deribit_member" in lines[0] and "pre_start_rows=5" in lines[0], lines[0]


@pytest.mark.asyncio
async def test_composite_allocated_twin_without_a_terminal_names_the_wallet_fallback(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        out = await run_allocated_composite(
            marks={"key-2": COMPOSITE_ALLOCATED_MARKS}, cfg=composite_config(),
            twin=Levels(None, TWIN.pnl, TWIN.flows),
        )
    assert out.run.result.outcome == DispatchOutcome.DONE, out.run.result.error_message
    lines = _fallback_lines(caplog)
    assert len(lines) == 1, caplog.text
    assert "site=composite_allocated_twin" in lines[0] and "pre_start_rows=5" in lines[0], lines[0]


@pytest.mark.asyncio
async def test_a_writer_chain_derive_names_no_fallback(caplog: pytest.LogCaptureFixture) -> None:
    """The warning is for the fallback only: a derive that takes the writer's base is silent."""
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        run = await derive_allocated(
            seeded(ALLOCATED_MARKS), cfg=config(), now_day="2026-03-08"
        )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    assert _fallback_lines(caplog) == [], caplog.text


# --------------------------------------------------------------------------------------
# 3. D-24 as amended: the tail lands on the writer's level on the last mark day
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "last_wallet", [2000.0, 1990.0], ids=["delta_zero", "wallet_below_writer"]
)
async def test_closed_allocated_mandate_tail_lands_on_the_writer_level(
    last_wallet: float,
) -> None:
    """The twin's terminal is (03-07, 2000.0), so its level at the end of the last mark day (03-07)
    is 2000.0. The 03-07 mark (NAV 1910.0) has a wallet of ``last_wallet``: 2000.0 (the writer
    level, nothing changes) or 1990.0 (read 10.0 away from it). The 03-08 tail row is the
    allocated 0.0123, and the level after it must be the writer's own 2000.0 * 1.0123, so
    r = 1.0123 * 2000 / 1910 - 1 whatever the wallet was."""
    db = seeded({**{"2026-03-06": 1900.0}})
    seed_mark(db, "2026-03-07", 1910.0, venue="deribit", open_pnl=1910.0 - last_wallet,
              native_unit=None)
    seed_mark(db, "2026-03-09", 1920.0, venue="deribit", open_pnl=10.0, native_unit=None)
    allocated = {**{d: v for d, v in PRE_MARK.items()}, "2026-03-06": 0.003, "2026-03-07": 0.0007,
                 "2026-03-08": 0.0123}
    closed = await derive_allocated(
        db, cfg=config(mandate_end="2026-03-08"), now_day="2026-03-10", allocated=allocated
    )
    assert closed.result.outcome == DispatchOutcome.DONE, closed.result.error_message
    assert closed.rows["2026-03-06"] == pytest.approx(R_0306, abs=1e-12)
    assert closed.rows["2026-03-07"] == pytest.approx(R_0307, abs=1e-12)
    assert closed.rows["2026-03-08"] == pytest.approx(R_TAIL_0308, abs=1e-12)
    assert 1910.0 * (1.0 + closed.rows["2026-03-08"]) == pytest.approx(2000.0 * 1.0123, abs=1e-9)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "last_wallet", [2000.0, 1990.0], ids=["delta_zero", "wallet_below_writer"]
)
async def test_closed_allocated_composite_member_tail_lands_on_the_writer_level(
    last_wallet: float,
) -> None:
    """The same case through a composite's allocated Deribit member (twin terminal (03-07, 2000.0))."""
    allocated = {**COMPOSITE_ALLOCATED, "2026-03-08": 0.0123}
    marks = [
        COMPOSITE_ALLOCATED_MARKS[0],
        stored("2026-03-07", 1910.0, venue="deribit", open_pnl=1910.0 - last_wallet),
        stored("2026-03-09", 1920.0, venue="deribit"),
    ]
    out = await run_allocated_composite(
        marks={"key-2": marks}, cfg=composite_config(mandate_end="2026-03-08"),
        now_day="2026-03-10", member2=allocated,
    )
    assert out.run.result.outcome == DispatchOutcome.DONE, out.run.result.error_message
    rows = out.run.csv_rows()
    assert rows["2026-03-08"] == pytest.approx(R_TAIL_0308, abs=1e-12)
    assert 1910.0 * (1.0 + rows["2026-03-08"]) == pytest.approx(2000.0 * 1.0123, abs=1e-9)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "last_wallet", [1025.0, 1020.0], ids=["delta_zero", "wallet_below_writer"]
)
async def test_closed_deribit_composite_member_tail_lands_on_the_writer_level(
    last_wallet: float,
) -> None:
    """Member 1 (window [01-01, 03-01), closed) holds M1_FULL: 02-26 .. 02-28 (0.010, -0.004,
    0.006). Its ledger's terminal is (02-28, 1030.0) with a 02-28 day P&L of 5.0, so the writer's
    level at the end of 02-27, the last mark day, is 1030.0 - 5.0 = 1025.0. The 02-27 mark (NAV
    1040.0) has a wallet of ``last_wallet``. The 02-28 tail row is 0.006, and the level after it
    must be the writer's own 1025.0 * 1.006: r = 1.006 * 1025 / 1040 - 1."""
    marks = [
        stored("2026-02-26", 1010.0, venue="deribit", open_pnl=10.0),
        stored("2026-02-27", 1040.0, venue="deribit", open_pnl=1040.0 - last_wallet),
    ]
    run, _ctxs = await run_deribit_composite(
        marks={"key-1": marks},
        extra_patches=[
            patch(
                "services.broker_dailies.native_ledger_realized_terminal",
                new=MagicMock(return_value=(pd.Timestamp("2026-02-28"), 1030.0)),
            ),
            patch(
                "services.broker_dailies.native_ledger_day_pnl",
                new=MagicMock(return_value=pd.Series(
                    [5.0], index=pd.DatetimeIndex(["2026-02-28"]), dtype="float64"
                )),
            ),
        ],
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    rows = run.csv_rows()
    assert rows["2026-02-28"] == pytest.approx(1.006 * 1025.0 / 1040.0 - 1.0, abs=1e-12)
    assert 1040.0 * (1.0 + rows["2026-02-28"]) == pytest.approx(1025.0 * 1.006, abs=1e-9)



# --------------------------------------------------------------------------------------
# 4. D-24 as corrected: a flow rule 10 moved into the last mark is carried by the tail row
# --------------------------------------------------------------------------------------


def _ms(*args: int) -> int:
    return int(datetime(*args, tzinfo=timezone.utc).timestamp() * 1000)


@pytest.mark.asyncio
@pytest.mark.parametrize("moved", [-500.0, 500.0], ids=["withdrawal", "deposit"])
async def test_closed_allocated_mandate_tail_carries_a_flow_moved_into_the_last_mark(
    moved: float,
) -> None:
    """The twin's terminal is (03-07, 2000.0), so the writer's level at the end of the last mark
    day is 2000.0. A USD flow of ``moved`` is dated 03-08 at 00:05Z, before the 00:10Z read of the
    03-07 mark, so rule 10 moves it into that mark: the mark's NAV is 2000.0 + moved (open profit
    0.0), and the writer's level (rolled over the pre-placement flows) does not hold it. The 03-08
    tail row is the allocated 0.0123, so the account goes from 2000.0 + moved to
    2000.0 * 1.0123 + moved, and the row is that ratio less one, whichever way the flow went."""
    db = seeded({"2026-03-06": 1900.0})
    seed_mark(db, "2026-03-07", 2000.0 + moved, venue="deribit", open_pnl=0.0, native_unit=None)
    seed_mark(db, "2026-03-09", 1920.0, venue="deribit", open_pnl=10.0, native_unit=None)
    allocated = {**PRE_MARK, "2026-03-06": 0.003, "2026-03-07": 0.0007, "2026-03-08": 0.0123}
    twin = Levels(
        ("2026-03-07", 2000.0), {"2026-03-06": 20.0, "2026-03-07": 5.0},
        {"2026-03-06": 100.0, "2026-03-08": moved},
    )
    closed = await derive_allocated(
        db, cfg=config(mandate_end="2026-03-08"), now_day="2026-03-10", allocated=allocated,
        twin=twin, twin_instants=(FlowInstant(_ms(2026, 3, 8, 0, 5), "2026-03-08", moved),),
    )
    assert closed.result.outcome == DispatchOutcome.DONE, closed.result.error_message
    assert closed.rows["2026-03-07"] == pytest.approx(100.0 / 1900.0, abs=1e-12)
    assert closed.rows["2026-03-08"] == pytest.approx(
        (2000.0 * 1.0123 + moved) / (2000.0 + moved) - 1.0, abs=1e-12
    )
    assert (2000.0 + moved) * (1.0 + closed.rows["2026-03-08"]) == pytest.approx(
        2000.0 * 1.0123 + moved, abs=1e-9
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("moved", [-500.0, 500.0], ids=["withdrawal", "deposit"])
async def test_closed_allocated_composite_member_tail_carries_a_flow_moved_into_the_last_mark(
    moved: float,
) -> None:
    """The same case through a composite's allocated Deribit member."""
    allocated = {**COMPOSITE_ALLOCATED, "2026-03-08": 0.0123}
    marks = [
        COMPOSITE_ALLOCATED_MARKS[0],
        stored("2026-03-07", 2000.0 + moved, venue="deribit"),
        stored("2026-03-09", 1920.0, venue="deribit"),
    ]
    twin = Levels(
        ("2026-03-07", 2000.0), {"2026-03-06": 20.0, "2026-03-07": 5.0},
        {"2026-03-06": 100.0, "2026-03-08": moved},
    )
    out = await run_allocated_composite(
        marks={"key-2": marks}, cfg=composite_config(mandate_end="2026-03-08"),
        now_day="2026-03-10", member2=allocated, twin=twin,
        twin_instants=(FlowInstant(_ms(2026, 3, 8, 0, 5), "2026-03-08", moved),),
    )
    assert out.run.result.outcome == DispatchOutcome.DONE, out.run.result.error_message
    rows = out.run.csv_rows()
    assert rows["2026-03-08"] == pytest.approx(
        (2000.0 * 1.0123 + moved) / (2000.0 + moved) - 1.0, abs=1e-12
    )
    assert (2000.0 + moved) * (1.0 + rows["2026-03-08"]) == pytest.approx(
        2000.0 * 1.0123 + moved, abs=1e-9
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("moved", [-500.0, 500.0], ids=["withdrawal", "deposit"])
async def test_closed_deribit_composite_member_tail_carries_a_flow_moved_into_the_last_mark(
    moved: float,
) -> None:
    """Member 1 (window [01-01, 03-01), closed). Its ledger's terminal is (02-28, 1030.0 + moved)
    with a 02-28 day P&L of 5.0 and a ``moved`` USD flow on 02-28 at 00:05Z, so the writer's level
    at the end of 02-27, the last mark day, is 1030.0 + moved - 5.0 - moved = 1025.0. The flow is
    before the 00:10Z read of the 02-27 mark, so rule 10 moves it into that mark, whose NAV is
    1025.0 + moved (open profit 0.0). The 02-28 tail row is 0.006: the account goes from
    1025.0 + moved to 1025.0 * 1.006 + moved."""
    marks = [
        stored("2026-02-26", 1010.0, venue="deribit", open_pnl=10.0),
        stored("2026-02-27", 1025.0 + moved, venue="deribit"),
    ]
    ledger = dataclasses.replace(
        _stub_ledger(),
        flow_instants=(FlowInstant(_ms(2026, 2, 28, 0, 5), "2026-02-28", moved),),
    )
    run, _ctxs = await run_deribit_composite(
        marks={"key-1": marks},
        ledgers={"key-1": ledger},
        composed={"key-1": {"2026-02-28": moved}},
        extra_patches=[
            patch(
                "services.broker_dailies.native_ledger_realized_terminal",
                new=MagicMock(return_value=(pd.Timestamp("2026-02-28"), 1030.0 + moved)),
            ),
            patch(
                "services.broker_dailies.native_ledger_day_pnl",
                new=MagicMock(return_value=pd.Series(
                    [5.0], index=pd.DatetimeIndex(["2026-02-28"]), dtype="float64"
                )),
            ),
        ],
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    rows = run.csv_rows()
    assert rows["2026-02-28"] == pytest.approx(
        (1025.0 * 1.006 + moved) / (1025.0 + moved) - 1.0, abs=1e-12
    )
    assert (1025.0 + moved) * (1.0 + rows["2026-02-28"]) == pytest.approx(
        1025.0 * 1.006 + moved, abs=1e-9
    )


# --------------------------------------------------------------------------------------
# 4b. D-24 as corrected again (round-3 CR-02): the term is what rule 10 TOOK OUT of the read day
# --------------------------------------------------------------------------------------

# A Deribit BTC or ETH flow keeps ``amount`` (its own-day ledger mark) and carries
# ``amount_prior_day`` (the quantity at the perp price of its minute). The mark holds the flow at
# the minute price, the read day gives back the own-day amount, and the two differ. The oracle is
# the landing identity ``M_last * (1 + r1') == L_writer(last+1) - F_post(last+1)``, typed from the
# fixture's own numbers with every flow moved (F_post = 0), so it cannot write the formula into
# itself: the writer's level after the tail row is ``L_writer(last) * (1 + r1)`` plus the whole
# flow at its own-day amount.
INDEXED_PRIOR_DAY_SHARE = 0.9


@pytest.mark.asyncio
@pytest.mark.parametrize("moved", [-500.0, 500.0], ids=["withdrawal", "deposit"])
async def test_closed_allocated_mandate_tail_lands_on_the_writer_level_for_an_indexed_flow(
    moved: float,
) -> None:
    """The same case as the USD test above, with ``amount_prior_day`` = 0.9 * ``amount``."""
    moved_in = INDEXED_PRIOR_DAY_SHARE * moved
    db = seeded({"2026-03-06": 1900.0})
    seed_mark(db, "2026-03-07", 2000.0 + moved_in, venue="deribit", open_pnl=0.0,
              native_unit=None)
    seed_mark(db, "2026-03-09", 1920.0, venue="deribit", open_pnl=10.0, native_unit=None)
    allocated = {**PRE_MARK, "2026-03-06": 0.003, "2026-03-07": 0.0007, "2026-03-08": 0.0123}
    twin = Levels(
        ("2026-03-07", 2000.0), {"2026-03-06": 20.0, "2026-03-07": 5.0},
        {"2026-03-06": 100.0, "2026-03-08": moved},
    )
    closed = await derive_allocated(
        db, cfg=config(mandate_end="2026-03-08"), now_day="2026-03-10", allocated=allocated,
        twin=twin,
        twin_instants=(
            FlowInstant(_ms(2026, 3, 8, 0, 5), "2026-03-08", moved, "USD", moved_in),
        ),
    )
    assert closed.result.outcome == DispatchOutcome.DONE, closed.result.error_message
    assert (2000.0 + moved_in) * (1.0 + closed.rows["2026-03-08"]) == pytest.approx(
        2000.0 * 1.0123 + moved, abs=1e-9
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("moved", [-500.0, 500.0], ids=["withdrawal", "deposit"])
async def test_closed_allocated_composite_member_tail_lands_on_the_writer_level_for_an_indexed_flow(
    moved: float,
) -> None:
    """The same case through a composite's allocated Deribit member."""
    moved_in = INDEXED_PRIOR_DAY_SHARE * moved
    allocated = {**COMPOSITE_ALLOCATED, "2026-03-08": 0.0123}
    marks = [
        COMPOSITE_ALLOCATED_MARKS[0],
        stored("2026-03-07", 2000.0 + moved_in, venue="deribit"),
        stored("2026-03-09", 1920.0, venue="deribit"),
    ]
    twin = Levels(
        ("2026-03-07", 2000.0), {"2026-03-06": 20.0, "2026-03-07": 5.0},
        {"2026-03-06": 100.0, "2026-03-08": moved},
    )
    out = await run_allocated_composite(
        marks={"key-2": marks}, cfg=composite_config(mandate_end="2026-03-08"),
        now_day="2026-03-10", member2=allocated, twin=twin,
        twin_instants=(
            FlowInstant(_ms(2026, 3, 8, 0, 5), "2026-03-08", moved, "USD", moved_in),
        ),
    )
    assert out.run.result.outcome == DispatchOutcome.DONE, out.run.result.error_message
    rows = out.run.csv_rows()
    assert (2000.0 + moved_in) * (1.0 + rows["2026-03-08"]) == pytest.approx(
        2000.0 * 1.0123 + moved, abs=1e-9
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("moved", [-500.0, 500.0], ids=["withdrawal", "deposit"])
async def test_closed_deribit_composite_member_tail_lands_on_the_writer_level_for_an_indexed_flow(
    moved: float,
) -> None:
    """The same case as the USD Deribit member test above, with ``amount_prior_day`` = 0.9 *
    ``amount``: the writer's level after the 02-28 tail row is 1025.0 * 1.006 plus the whole flow."""
    moved_in = INDEXED_PRIOR_DAY_SHARE * moved
    marks = [
        stored("2026-02-26", 1010.0, venue="deribit", open_pnl=10.0),
        stored("2026-02-27", 1025.0 + moved_in, venue="deribit"),
    ]
    ledger = dataclasses.replace(
        _stub_ledger(),
        flow_instants=(
            FlowInstant(_ms(2026, 2, 28, 0, 5), "2026-02-28", moved, "USD", moved_in),
        ),
    )
    run, _ctxs = await run_deribit_composite(
        marks={"key-1": marks},
        ledgers={"key-1": ledger},
        composed={"key-1": {"2026-02-28": moved}},
        extra_patches=[
            patch(
                "services.broker_dailies.native_ledger_realized_terminal",
                new=MagicMock(return_value=(pd.Timestamp("2026-02-28"), 1030.0 + moved)),
            ),
            patch(
                "services.broker_dailies.native_ledger_day_pnl",
                new=MagicMock(return_value=pd.Series(
                    [5.0], index=pd.DatetimeIndex(["2026-02-28"]), dtype="float64"
                )),
            ),
        ],
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    rows = run.csv_rows()
    assert (1025.0 + moved_in) * (1.0 + rows["2026-02-28"]) == pytest.approx(
        1025.0 * 1.006 + moved, abs=1e-9
    )


TAIL_FALLBACK = "tail landing falls back to the wallet"


@pytest.mark.asyncio
async def test_closed_allocated_mandate_tail_falls_back_to_the_wallet_on_an_unusable_writer_level(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The twin's terminal is (03-07, -50.0): the writer's level at the end of the last mark day is
    not above the dust floor (a 03-07 day P&L of -1500.0 took it below zero), while the first
    mark's base, 03-05's level, is -50.0 - (20.0 - 1500.0) - 100.0 = 1330.0 and is usable. A tail
    row landed on a non-positive level would be a nonsense return, so the tail keeps the original
    D-24 level, the last mark's wallet (1910.0 + 90.0 = 2000.0), and says so once: a static
    WARNING with counts only."""
    db = seeded({"2026-03-06": 1900.0})
    seed_mark(db, "2026-03-07", 1910.0, venue="deribit", open_pnl=-90.0, native_unit=None)
    seed_mark(db, "2026-03-09", 1920.0, venue="deribit", open_pnl=10.0, native_unit=None)
    allocated = {**PRE_MARK, "2026-03-06": 0.003, "2026-03-07": 0.0007, "2026-03-08": 0.0123}
    twin = Levels(
        ("2026-03-07", -50.0), {"2026-03-06": 20.0, "2026-03-07": -1500.0}, {"2026-03-06": 100.0}
    )
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        closed = await derive_allocated(
            db, cfg=config(mandate_end="2026-03-08"), now_day="2026-03-10",
            allocated=allocated, twin=twin,
        )
    assert closed.result.outcome == DispatchOutcome.DONE, closed.result.error_message
    assert closed.rows["2026-03-08"] == pytest.approx(R_TAIL_0308, abs=1e-12)
    lines = [
        r.getMessage() for r in caplog.records
        if r.levelname == "WARNING" and TAIL_FALLBACK in r.getMessage()
    ]
    assert len(lines) == 1, caplog.text
    assert "tail_rows=1" in lines[0], lines[0]
    assert "-50" not in lines[0] and "key-" not in lines[0], lines[0]
