"""Phase 185 plan 08 (SC-2, SC-5, D-04) - key mode measures Deribit options at market.

Before this plan a Deribit allocator key (key mode) was built on the CASH basis only
(``DEFAULT_PNL_BASIS``): the level a day's return divides by was the cash wallet, which leaves out
an open option book. An option round trip therefore printed -48 percent, then +333 percent (the
2025-07-11..13 shape; RESEARCH Q10). D-04 (founder 2026-11-01, "Replan 185 for options") makes the
options basis the key's HEADLINE, not an additive pass, built from the SAME transaction-log crawl as
the cash ledger (plan 185-07's ``build_deribit_options_basis_ledger``), and F1 chose the smoothed
basis. One ledger then feeds EVERY writer quantity: ``returns``, the day P&L, the composed flows,
the realized terminal, the flow instants and the ``apply_marks`` writer terminal.

The RED oracle and its source
-----------------------------
``tests/fixtures/deribit_option_round_trip.py`` (plan 185-07). Day 0 is a deposit of
``ROUND_TRIP_S``; over the next three days the CASH basis returns (-0.4839, +0.0280, +3.3339) and
the OPTIONS basis (0.0000, +0.1740, +0.9586), the same cumulative +1.2994. Those are the research
figures (RESEARCH Q10, ran against the repo's own ``chain_linked_twr``); the fixture's exact
numbers differ from them by at most 3e-4, so every comparison is ``abs=5e-4``. The cash numbers are
what a key-mode derive persisted before this plan, so the tracer test is RED on the cash basis.

Neuter-falsifiability (test -> mutation it kills):
  * ``test_key_mode_options_book_persists_the_options_basis`` - kills deleting the
    ``returns, meta`` rebind (returns stay cash), keeping the cash ledger for the day P&L, the
    terminal or the composed flows (a mixed basis), or never calling the assembler.
  * ``test_key_mode_perp_only_book_never_calls_the_options_assembler`` - kills dropping the
    ``has_option_activity is True`` gate: a perp-only key built on the options basis would take a
    different wedge (T-185-23, RESEARCH Pitfall 1).
  * ``test_key_mode_options_failure_falls_back_to_cash_with_the_caveat`` - kills removing the
    local structural catch: the error would reach the cash pass's permanent arms and freeze the
    key's curve (T-185-21, Pitfall 2).
  * ``test_key_mode_options_transient_is_never_a_degrade`` - kills widening that catch to a
    transient read error.
  * ``test_the_options_step_runs_only_on_a_strict_true`` - kills loosening the gate to truthiness.

The seam (marks join the options history) is pinned in the middle of this module, and the budget
bound (plan 185-09) at the end:
  * ``test_options_step_timeout_keeps_cash_and_the_caveat`` and
    ``test_options_step_is_bounded_by_a_slice_of_the_remaining_budget`` - kill deleting the local
    ``except asyncio.TimeoutError`` arm (the timeout would reach the cash pass's outer arm, a
    retryable transient, and the whole derive would retry to ``failed_final``, HIGH-01) and
    deleting the ``asyncio.wait_for`` (a hung options read would run unbounded).
  * ``test_options_step_below_the_floor_never_starts`` - kills dropping the
    ``_MTM_SECOND_PASS_MIN_SECONDS`` refusal.
  * ``test_bucketed_option_days_keep_cash_and_the_caveat`` and
    ``test_bucketed_days_keep_the_cash_ledgers_own_return`` (F2, f2-a, D-07) - kill dropping the
    bucketed-day term from the caveat rule (the caveat would clear while some option days are still
    measured at cash value, T-185-26) and any interpolation of a bucketed day (SC-5).
  * ``test_options_step_transient_still_retries`` - kills adding ``DeribitTransientReadError`` (or
    ``ValueError``) to the structural catch.

Network-free: every I/O primitive is a stub, as in ``test_mtm_single_key.py`` whose helpers this
module reuses.
"""
from __future__ import annotations

import asyncio
import dataclasses
import logging
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.broker_dailies import (
    combine_native_ledger,
    native_ledger_composed_flows,
    native_ledger_day_pnl,
    native_ledger_realized_terminal,
)
from services import deribit_ingest as di
from services.deribit_ingest import CompletenessReport, DeribitTransientReadError
from services.deribit_txn import LedgerValuationError
from services import job_worker
from services.deribit_txn import PNL_BASIS_SMOOTHED_MTM
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from services.native_nav import NativeLedger
from tests.fixtures.deribit_option_round_trip import (
    ROUND_TRIP_S,
    cash_round_trip_ledger,
    options_round_trip_ledger,
)
from tests.test_allocator_equity_dropped_day_pnl import _csv_returns, _key_inputs_payload
from services.deribit_ingest import DeribitNativeAccountState
from services.external_flows import ExternalFlow
from tests.test_flow_price_store import FlowPricesTable, route_flow_prices
from tests.test_deribit_options_basis_ledger import _install_stubs
from tests.test_mtm_single_key import _apply, _base_patches, _ctx, _report
from tests.test_smoothed_mtm_core import (
    _HELD_CHARTS,
    _HELD_ROWS,
    _PRE_RET_INSTR,
    _OptionsAdapterStub,
    _mk_ms,
    _opt_row,
)
from tests.test_nav_marks_compose_roundtrip import (
    KEY_DRB,
    USER,
    KeyDb,
    assert_levels,
    assert_trustworthy,
    compose_curve,
    levels,
    route_key_csv,
)
from tests.test_nav_marks_derive_apply import at_0010, seed_mark
from tests.test_nav_marks_writer import route_marks

_KEY_ID = "key-drb"
# F1 (founder 2026-11-01, D-05, plan 185-06 ``f1-answer: f1-a``): an allocator book uses the
# SMOOTHED options basis. Typed here, not read from the constant under test.
_F1_BASIS = PNL_BASIS_SMOOTHED_MTM
_DAYS = ("2025-07-11", "2025-07-12", "2025-07-13")

# The research oracle (RESEARCH Q10), compared within 5e-4 because the fixture's exact numbers
# differ from the rounded research figures by at most 3e-4 (plan 185-07).
_ORACLE_OPTIONS = (0.0000, 0.1740, 0.9586)
_ORACLE_CASH = (-0.4839, 0.0280, 3.3339)
_TOL = 5e-4


def _round_trip_report(*, has_option_activity: object = True) -> CompletenessReport:
    """A complete report for the USDC round trip: no indexable coin (a USD-native account) and
    the ledger's own dated flows, which is what the derive stores in ``flows``."""
    return dataclasses.replace(
        _report(has_option_activity=False),
        has_option_activity=has_option_activity,  # type: ignore[arg-type]
        indexable_currencies=frozenset(),
        dated_external_flows=list(cash_round_trip_ledger().native_flows),
    )


async def _run_derive(
    *,
    options_mock: AsyncMock,
    has_option_activity: object = True,
    cash_ledger: NativeLedger | None = None,
    extra_patches: tuple[Any, ...] = (),
    capture_sink: list[dict[str, Any]] | None = None,
    report: CompletenessReport | None = None,
    account_state: DeribitNativeAccountState | None = None,
) -> tuple[Any, dict[str, Any], AsyncMock, dict[str, Any]]:
    """A Deribit key-mode derive over the round trip with the REAL combine, day P&L, composed-flows
    and realized-terminal functions. The cash build returns the cash ledger; ``options_mock`` is the
    options assembler. Returns ``(result, key_inputs payload, cash build mock, capture)``."""
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    if capture_sink is not None:
        capture_sink.append(capture)  # reachable even when the derive raises
    if report is None:
        report = _round_trip_report(has_option_activity=has_option_activity)
    ledger_mock = AsyncMock(
        return_value=(cash_ledger if cash_ledger is not None else cash_round_trip_ledger(), report)
    )
    patches = _base_patches(
        ctx,
        key_mode=True,
        ledger_mock=ledger_mock,
        combine_mock=MagicMock(),
        state_spy=AsyncMock(return_value=account_state) if account_state is not None else None,
    ) + [
        patch("services.broker_dailies.combine_native_ledger", new=combine_native_ledger),
        patch("services.broker_dailies.native_ledger_day_pnl", new=native_ledger_day_pnl),
        patch(
            "services.broker_dailies.native_ledger_realized_terminal",
            new=native_ledger_realized_terminal,
        ),
        patch(
            "services.broker_dailies.native_ledger_composed_flows",
            new=native_ledger_composed_flows,
        ),
        # A fixed clock: the payload carries the derive's read instants, and two derives of the
        # same ledger must be byte-comparable.
        patch("services.job_worker._utc_now", new=MagicMock(return_value=at_0010("2026-11-01"))),
        *extra_patches,
        # Placed last so it replaces the harness default that refuses the options basis.
        patch("services.deribit_ingest.build_deribit_options_basis_ledger", new=options_mock),
    ]
    with _apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j-drb-opt", "kind": "derive_broker_dailies", "api_key_id": _KEY_ID}
        )
    return result, _key_inputs_payload(capture, _KEY_ID), ledger_mock, capture


def _options_ok() -> AsyncMock:
    return AsyncMock(return_value=(options_round_trip_ledger(), _round_trip_report()))


def _persisted(capture: dict[str, Any]) -> list[float]:
    returns = _csv_returns(capture)
    return [float(returns[d]) for d in _DAYS]


def _day_pnl(payload: dict[str, Any]) -> dict[str, float]:
    return {r["utc_day_iso"]: r["pnl_usd"] for r in payload["composed_day_pnl"]}


# ── Task 1: the tracer ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_key_mode_options_book_persists_the_options_basis() -> None:
    """SC-5. An option-activity key persists the options-basis returns and the options ledger's own
    day P&L and terminal, not the cash wallet's. On the cash basis it persisted
    (-0.4839, +0.0280, +3.3339), so this is RED before the options step exists.

    The day P&L is the writer's ``NAV_t - NAV_{t-1} - F_t``, typed here from ``ROUND_TRIP_S``:
      options  day 1  0.0000 S    day 2  0.1740 S    day 3  1.1253 S
      cash     day 1 -0.4839 S    day 2  0.0144 S    day 3  1.7688 S
    and the realized terminal is the deposit S plus the cumulative P&L 1.2993 S less the
    0.6016 S withdrawal: 1.6977 S on 2025-07-13 (the same under either basis here)."""
    options_mock = _options_ok()
    result, payload, ledger_mock, capture = await _run_derive(options_mock=options_mock)
    assert result.outcome == DispatchOutcome.DONE

    for got, want in zip(_persisted(capture), _ORACLE_OPTIONS, strict=True):
        assert got == pytest.approx(want, abs=_TOL)

    pnl = _day_pnl(payload)
    assert pnl["2025-07-11"] == pytest.approx(0.0000 * ROUND_TRIP_S, abs=1.0)
    assert pnl["2025-07-12"] == pytest.approx(0.1740 * ROUND_TRIP_S, abs=1.0)
    assert pnl["2025-07-13"] == pytest.approx(1.1253 * ROUND_TRIP_S, abs=1.0)
    assert payload["realized_terminal_usd"] == pytest.approx(1.6977 * ROUND_TRIP_S, abs=1.0)
    assert payload["realized_terminal_day"] == "2025-07-13"

    assert payload["options_basis"] == _F1_BASIS
    assert "options_cash_basis" not in payload  # self-clearing once the options basis applied (F3)

    # One crawl, asked to retain its rows; the assembler was handed that crawl's report.
    ledger_mock.assert_awaited_once()
    assert ledger_mock.await_args.kwargs["retain_raw_rows"] is True
    options_mock.assert_awaited_once()
    assert options_mock.await_args.kwargs["pnl_basis"] == _F1_BASIS


def test_key_mode_options_bases_are_the_founders_f1_choice() -> None:
    """F1 (D-05): the ordered tuple of bases the key-mode options step tries is exactly the
    smoothed basis. Neuter: set it to the mark-to-market basis -> RED."""
    assert getattr(job_worker, "_KEY_MODE_OPTIONS_BASES", None) == (_F1_BASIS,)


@pytest.mark.asyncio
async def test_key_mode_perp_only_book_never_calls_the_options_assembler() -> None:
    """T-185-23. ``has_option_activity=False`` leaves the assembler un-awaited and the persisted
    rows and payload equal those of the same derive with the assembler patched to raise: a
    perp-only key takes no part in the options basis (its terminal wedge would differ,
    RESEARCH Pitfall 1)."""
    ok = _options_ok()
    _r1, payload_ok, _l1, capture_ok = await _run_derive(
        options_mock=ok, has_option_activity=False
    )
    boom = AsyncMock(side_effect=LedgerValuationError("must never be called"))
    result, payload_boom, _l2, capture_boom = await _run_derive(
        options_mock=boom, has_option_activity=False
    )
    assert result.outcome == DispatchOutcome.DONE
    ok.assert_not_awaited()
    boom.assert_not_awaited()
    # ``anchor_asof`` is the derive's own wall-clock read instant, the one field two derives of
    # the same ledger cannot share.
    assert {k: v for k, v in payload_ok.items() if k != "anchor_asof"} == {
        k: v for k, v in payload_boom.items() if k != "anchor_asof"
    }
    assert "options_basis" not in payload_ok and "options_cash_basis" not in payload_ok
    assert _persisted(capture_ok) == _persisted(capture_boom)
    # ... and they are the cash rows, untouched.
    for got, want in zip(_persisted(capture_ok), _ORACLE_CASH, strict=True):
        assert got == pytest.approx(want, abs=_TOL)


@pytest.mark.asyncio
async def test_key_mode_options_failure_falls_back_to_cash_with_the_caveat() -> None:
    """T-185-21. A structural failure of the options basis (a hole, a retention straddler, a
    book-channel breach) leaves the derive DONE on the cash ledger: the rows are the cash oracle,
    ``options_cash_basis`` is True and there is no ``options_basis``. It never reaches the cash
    pass's permanent arms (which would freeze the key's curve on its last row)."""
    boom = AsyncMock(side_effect=LedgerValuationError("hole in the option marks"))
    result, payload, _ledger_mock, capture = await _run_derive(options_mock=boom)
    assert result.outcome == DispatchOutcome.DONE
    boom.assert_awaited_once()
    for got, want in zip(_persisted(capture), _ORACLE_CASH, strict=True):
        assert got == pytest.approx(want, abs=_TOL)
    assert payload["options_cash_basis"] is True
    assert "options_basis" not in payload
    # The cash ledger's own day P&L: day 1 is the premium day (-0.4839 S).
    assert _day_pnl(payload)["2025-07-11"] == pytest.approx(-0.4839 * ROUND_TRIP_S, abs=1.0)


@pytest.mark.asyncio
async def test_key_mode_options_transient_is_never_a_degrade() -> None:
    """A transient read error from the options step propagates (the dispatcher retries the whole
    derive); it is never swallowed as a cash degrade, and a bare ``ValueError`` (a programming
    error from the assembler's guards) is not caught either."""
    for exc in (DeribitTransientReadError("chart read blip"), ValueError("no raw rows")):
        boom = AsyncMock(side_effect=exc)
        with pytest.raises(type(exc)):
            await _run_derive(options_mock=boom)


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [1, "true"], ids=["int-one", "string-true"])
async def test_the_options_step_runs_only_on_a_strict_true(value: object) -> None:
    """The producer's contract is a bool. A truthy non-bool never raises the options step (nor the
    caveat), the same strictness the 185-04 setter has."""
    options_mock = _options_ok()
    result, payload, _l, _c = await _run_derive(
        options_mock=options_mock, has_option_activity=value
    )
    assert result.outcome == DispatchOutcome.DONE
    options_mock.assert_not_awaited()
    assert "options_basis" not in payload and "options_cash_basis" not in payload


# ── Task 2: the seam - the options history joins the marks, no day counted twice ──────────
#
# RESEARCH Q6 and G-01 (``services/nav_marks_apply.py`` docstring rules 2-6, 8, 9, 13, 14).
# ``apply_marks`` is the only join between the writer's ledger series and the NAV marks:
#   * days before ``S`` (the key's first mark) keep the writer's series exactly, which for an
#     option-activity key is now the OPTIONS-basis series;
#   * ``S`` is ``(M_S - L(S-1) - F_S) / L(S-1)``, where ``L(S-1)`` is the writer's OWN realized
#     level reached from its terminal (G-01), so with the options ledger the base includes the
#     option book and ``r(S)`` no longer books the whole book as a return;
#   * days after ``S`` are the mark days only; a gap day is absent and listed in ``mark_gap_days``;
#   * a day's flow is placed once.
# A hybrid (options returns, a cash terminal or day P&L) breaks exactly that, which is why the
# four quantities must come from ONE ledger (Pitfall 3).
#
# The ledger pair below is the round trip of ``tests/fixtures/deribit_option_round_trip.py`` cut
# at the end of day 2: the option book is still OPEN there. Every figure is a ratio of
# ``ROUND_TRIP_S`` (S0), typed beside its arithmetic. USDC, no indexable coin, so a USD return
# equals the native one.
#
#   day            03-01   03-02    03-03    (03-04 = S)   03-05 (gap)   03-06
#   options pnl     -       0.0000   0.1740 S0
#   cash pnl        -      -0.4839  +0.0144 S0
#   options level  1.0000   1.0000   1.1740 S0   <- L_opt(S-1): includes the open option book
#   cash level     1.0000   0.5161   0.5305 S0   <- the cash wallet: the option book (0.6435) is out
#   marks (NAV)                                  1.2000 S0                  1.2360 S0
#
# Both ledgers share one live equity (1.1740 S0, option book included). The cash ledger carries
# the option book as its terminal wedge (``terminal_upnl_native`` 0.6435 S0), which is how the
# real cash basis strips it from the level; the options ledger carries none.

_SEAM_D0 = "2026-03-01"
_SEAM_PRE_S = ("2026-03-02", "2026-03-03")
_SEAM_S = "2026-03-04"
_SEAM_GAP = "2026-03-05"
_SEAM_LAST = "2026-03-06"
_SEAM_MARKS = {_SEAM_S: 1.2000 * ROUND_TRIP_S, _SEAM_LAST: 1.2360 * ROUND_TRIP_S}

_S0 = ROUND_TRIP_S
_SEAM_OPTIONS_PNL = (0.0000 * _S0, 0.1740 * _S0)
_SEAM_CASH_PNL = (-0.4839 * _S0, 0.0144 * _S0)
_SEAM_EQUITY = 1.1740 * _S0  # the live equity both ledgers anchor on
_SEAM_OPTION_BOOK = 0.6435 * _S0  # open at the end of 03-03, valued by the options basis only

# The oracle levels, typed from the table above and NOT read from the code under test.
_L_OPTIONS = {_SEAM_D0: 1.0000 * _S0, "2026-03-02": 1.0000 * _S0, "2026-03-03": 1.1740 * _S0}
_L_CASH_AT_S_MINUS_1 = 0.5305 * _S0  # 1.1740 S0 live equity less the 0.6435 S0 option book
# r(S): the options base 1.1740 S0 holds the option book, the cash base 0.5305 S0 does not.
_R_S_OPTIONS = (1.2000 - 1.1740) / 1.1740  # = 0.0221465
_R_S_CASH_WALLET = (1.2000 - 0.5305) / 0.5305  # = 1.2621 : the book booked as a return
_R_LAST = (1.2360 - 1.2000) / 1.2000  # = 0.03, the gap day 03-05 carries no flow


def _seam_ledger(pnl: tuple[float, float], *, wedge: float) -> NativeLedger:
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in _SEAM_PRE_S])
    return NativeLedger(
        native_pnl={"USDC": pd.Series(list(pnl), index=index, dtype="float64")},
        terminal_native_equity={"USDC": _SEAM_EQUITY},
        marks={},
        native_flows=[ExternalFlow(_SEAM_D0, _S0, "USDC", _S0)],
        terminal_upnl_native={"USDC": wedge} if wedge else {},
        full_history=True,
    )


def _seam_cash_ledger() -> NativeLedger:
    return _seam_ledger(_SEAM_CASH_PNL, wedge=_SEAM_OPTION_BOOK)


def _seam_options_ledger() -> NativeLedger:
    return _seam_ledger(_SEAM_OPTIONS_PNL, wedge=0.0)


@pytest.fixture
def real_marks_writer(monkeypatch: pytest.MonkeyPatch) -> None:
    """The seam test is about what the derive does with STORED marks, so it needs the real marks
    writer back (conftest installs a stand-in). A plain fixture the seam test asks for, not the
    autouse one ``test_nav_marks_writer`` defines: the tracer tests above route no marks table."""
    import services.job_worker as job_worker_module
    import services.nav_marks as nav_marks

    monkeypatch.setattr(job_worker_module, "write_nav_mark", nav_marks.write_nav_mark)


async def _derive_with_marks(db: KeyDb) -> tuple[Any, dict[str, Any]]:
    """The key-mode derive over the seam pair (real combine and ledger helpers, the options
    assembler returning the options ledger) with the marks table holding two stored marks."""
    for day, nav in _SEAM_MARKS.items():
        seed_mark(
            db, day, nav, key=KEY_DRB, venue="deribit", open_pnl=0.0, native_unit=None
        )
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    ctx.key_row = {"id": KEY_DRB, "user_id": USER, "exchange": "deribit"}
    route_flow_prices(route_key_csv(route_marks(ctx, db), db), FlowPricesTable())
    live = _SEAM_MARKS[_SEAM_LAST]
    state = DeribitNativeAccountState(
        native_equity={"USDC": live}, native_upnl={}, collapsed_equity_usd=live,
        collapsed_upnl_usd=0.0, balance_error=False, upnl_unreadable=False,
        native_options_value={}, native_balance={"USDC": live}, index_usd_snapshot={},
    )
    report = dataclasses.replace(
        _report(has_option_activity=True),
        indexable_currencies=frozenset(),
        dated_external_flows=list(_seam_cash_ledger().native_flows),
    )
    options_report = dataclasses.replace(report)
    patches = _base_patches(
        ctx,
        key_mode=True,
        ledger_mock=AsyncMock(return_value=(_seam_cash_ledger(), report)),
        combine_mock=MagicMock(),
        state_spy=AsyncMock(return_value=state),
    ) + [
        patch("services.broker_dailies.combine_native_ledger", new=combine_native_ledger),
        patch("services.broker_dailies.native_ledger_day_pnl", new=native_ledger_day_pnl),
        patch(
            "services.broker_dailies.native_ledger_realized_terminal",
            new=native_ledger_realized_terminal,
        ),
        patch(
            "services.broker_dailies.native_ledger_composed_flows",
            new=native_ledger_composed_flows,
        ),
        patch("services.job_worker._utc_now", new=MagicMock(return_value=at_0010("2026-03-07"))),
        # Fixtures sit in March 2026 and the retention terminus reads the wall clock; pinned off
        # (the whole window is inside retention), as the compose round-trip suite does.
        patch("services.nav_twr.flow_coverage_terminus_day", new=MagicMock(return_value=None)),
        patch(
            "services.deribit_flow_prices.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
        patch(
            "services.deribit_ingest.build_deribit_options_basis_ledger",
            new=AsyncMock(return_value=(_seam_options_ledger(), options_report)),
        ),
    ]
    with _apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j-drb-seam", "kind": "derive_broker_dailies", "api_key_id": KEY_DRB}
        )
    return result, capture


@pytest.mark.asyncio
async def test_options_history_joins_the_marks_with_no_day_counted_twice(
    real_marks_writer: None,
) -> None:
    """RESEARCH Q6 / G-01, all five parts, through the real derive and the real compose.

    (i)   every stored day before S is the options ledger's own return (0.0000, 0.1740);
    (ii)  the stored days on and after S are exactly {S, S+2} (the marks);
    (iii) no day is stored twice, S+1 is absent, and ``mark_gap_days`` is [S+1];
    (iv)  the compose's levels equal both marked NAVs and the options ledger's level at S-1 (and
          its earlier levels), with no blocking degrade (``inception_unreconciled`` among them);
    (v)   r(S) is (M_S - L_options(S-1)) / L_options(S-1) = 0.0221, NOT the cash-wallet base's
          1.2621, which would book the whole open option book as one day's return.

    Neuter: make the day P&L, the composed flows and the realized terminal read the CASH ledger
    while the returns stay on the options ledger (the hybrid) -> (iv) and (v) go RED."""
    db = KeyDb()
    result, capture = await _derive_with_marks(db)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows(KEY_DRB)

    # (i) before S: the options ledger's returns, 0/1.0000 and 0.1740/1.0000.
    assert {d: v for d, v in rows.items() if d < _SEAM_S} == pytest.approx(
        {"2026-03-02": 0.0, "2026-03-03": 0.1740}, abs=1e-12
    )
    # (ii) on and after S: exactly the mark days.
    assert sorted(d for d in rows if d >= _SEAM_S) == [_SEAM_S, _SEAM_LAST]
    # (iii) no day counted twice and none missing: every written day appears in exactly one
    # upsert across the whole derive, the gap day was never written, and the key_inputs names it.
    written = [row["date"] for batch in db.csv_upserts for row in batch]
    assert len(written) == len(set(written)), written
    assert sorted(set(written)) == sorted(rows)
    assert _SEAM_GAP not in rows
    payload = _key_inputs_payload(capture, KEY_DRB)
    assert payload["mark_gap_days"] == [_SEAM_GAP]
    assert payload["marks_since"] == _SEAM_S
    # (v) the marked day against the options base, typed: (1.2000 - 1.1740) / 1.1740.
    assert rows[_SEAM_S] == pytest.approx(_R_S_OPTIONS, abs=1e-9)
    assert abs(rows[_SEAM_S] - _R_S_CASH_WALLET) > 1.0  # the cash-wallet base is a different day
    # the next return spans the gap day: (1.2360 - 1.2000) / 1.2000.
    assert rows[_SEAM_LAST] == pytest.approx(_R_LAST, abs=1e-9)
    # (iv) the compose, over exactly what the derive persisted, lands on every marked level and
    # on the options levels at and before S-1.
    curve_payload = await compose_curve(db, capture, key=KEY_DRB, venue="deribit")
    curve = levels(curve_payload)
    assert {"2026-03-02", "2026-03-03"} <= set(curve), sorted(curve)  # the pre-S levels exist
    assert_levels(curve, {**_SEAM_MARKS, **{d: v for d, v in _L_OPTIONS.items() if d in curve}})
    assert curve["2026-03-03"] == pytest.approx(_L_OPTIONS["2026-03-03"], rel=1e-9)
    assert "inception_unreconciled" not in curve_payload["degrade_reasons"]
    assert_trustworthy(curve_payload)


# ── Plan 185-09: the options step is bounded by a slice of the remaining derive budget ──────
#
# RESEARCH Q4 and Pitfall 4. The strategy smoothed pass bounds a SECOND crawl; key mode reuses the
# cash crawl, so it bounds only the options step (one public chart request per held instrument plus
# the dense index marks). An unbounded step that overran the 900 s derive budget would turn a healthy
# cash derive into ``failed_final`` (the outer arm retries the whole derive three times). D-04 and
# FIX-2: slice = ``_MTM_SECOND_PASS_BUDGET_FRACTION`` of the REMAINING budget, refuse to start below
# ``_MTM_SECOND_PASS_MIN_SECONDS``, and on refusal or timeout keep the cash ledger WITH the caveat.


def _budget_warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        r.getMessage()
        for r in caplog.records
        if r.levelno == logging.WARNING
        and r.name == job_worker.logger.name
        and "key-mode options basis" in r.getMessage()
    ]


def _assert_cash_oracle_with_the_caveat(payload: dict[str, Any], capture: dict[str, Any]) -> None:
    for got, want in zip(_persisted(capture), _ORACLE_CASH, strict=True):
        assert got == pytest.approx(want, abs=_TOL)
    assert payload["options_cash_basis"] is True
    assert "options_basis" not in payload


@pytest.mark.asyncio
async def test_options_step_timeout_keeps_cash_and_the_caveat(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """HIGH-01. A timeout from the options step (through the bound) degrades: the derive ends DONE
    (never ``failed_final``), the rows are the cash oracle, ``options_cash_basis`` is True, and one
    WARNING names the bounded seconds and the venue. Without the local ``except
    asyncio.TimeoutError`` the error reaches the cash pass's outer arm, a retryable transient."""
    timed_out = AsyncMock(side_effect=asyncio.TimeoutError())
    with caplog.at_level(logging.WARNING, logger=job_worker.logger.name):
        result, payload, _ledger_mock, capture = await _run_derive(options_mock=timed_out)
    assert result.outcome == DispatchOutcome.DONE
    timed_out.assert_awaited_once()
    _assert_cash_oracle_with_the_caveat(payload, capture)
    warnings = _budget_warnings(caplog)
    assert len(warnings) == 1, warnings
    assert "exceeded its bounded" in warnings[0] and "s budget" in warnings[0]
    assert "venue=deribit" in warnings[0]


@pytest.mark.asyncio
async def test_options_step_is_bounded_by_a_slice_of_the_remaining_budget(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The bound is a real ``wait_for``: an assembler that never returns is cancelled at
    ``_MTM_SECOND_PASS_BUDGET_FRACTION`` of the remaining budget and the derive degrades to cash.
    The floor, the post-crawl reserve and the price-read floor are lowered to zero and the budget
    to 1.5 s so the slice is about a second; the assembler must have STARTED (a refusal would also keep cash, and prove nothing about the bound).
    Neuter: delete the ``wait_for`` and the hung assembler sleeps the full 30 s."""
    started = asyncio.Event()

    async def _hang(*_args: Any, **_kwargs: Any) -> tuple[NativeLedger, CompletenessReport]:
        started.set()
        await asyncio.sleep(30)
        raise AssertionError("the bound must have cancelled this")

    hung = AsyncMock(side_effect=_hang)
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    with caplog.at_level(logging.WARNING, logger=job_worker.logger.name):
        result, payload, _ledger_mock, capture = await _run_derive(
            options_mock=hung,
            extra_patches=(
                patch.dict("services.job_worker.TIMEOUT_PER_KIND", {"derive_broker_dailies": 1.5}),
                patch("services.job_worker._MTM_SECOND_PASS_MIN_SECONDS", 0.0),
                patch("services.job_worker._DERIVE_POST_CRAWL_RESERVE_S", 0.0),
                patch("services.job_worker._MOVED_FLOW_PRICE_MIN_SECONDS", 0.0),
            ),
        )
    assert loop.time() - t0 < 10, "the options step ran unbounded"
    assert started.is_set(), "the options step never started, so the bound was not exercised"
    assert result.outcome == DispatchOutcome.DONE
    _assert_cash_oracle_with_the_caveat(payload, capture)
    assert len(_budget_warnings(caplog)) == 1


@pytest.mark.asyncio
async def test_options_step_below_the_floor_never_starts(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """FIX-2. When the cash crawl consumed so much of the derive budget that the slice is under
    ``_MTM_SECOND_PASS_MIN_SECONDS``, the assembler is never awaited, the rows are cash and the
    caveat is raised. The budget is shrunk to 1 s the way the strategy floor test does it
    (``test_smoothed_third_pass_insufficient_budget_skips_cash_ships``)."""
    options_mock = _options_ok()
    with caplog.at_level(logging.WARNING, logger=job_worker.logger.name):
        result, payload, _ledger_mock, capture = await _run_derive(
            options_mock=options_mock,
            extra_patches=(
                patch.dict("services.job_worker.TIMEOUT_PER_KIND", {"derive_broker_dailies": 1.0}),
            ),
        )
    assert result.outcome == DispatchOutcome.DONE
    options_mock.assert_not_awaited()
    _assert_cash_oracle_with_the_caveat(payload, capture)
    warnings = _budget_warnings(caplog)
    assert len(warnings) == 1, warnings
    assert "below the" in warnings[0] and "floor" in warnings[0]
    assert "venue=deribit" in warnings[0]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("budget_s", "starts"),
    [(180.0, False), (200.0, True)],
    ids=["slice-under-the-floor-after-the-reserve", "slice-clears-the-floor"],
)
async def test_options_step_slice_leaves_the_post_crawl_reserve(
    budget_s: float, starts: bool
) -> None:
    """WR-01. The step's slice is a fraction of what is left AFTER the post-crawl reserve (90 s)
    and the moved-flow price-read floor (10 s), so the later at-instant read, the mark write and
    the persist still start. With a 180 s budget the slice is (180 - 90 - 10) * 0.7 = 56 s, under
    the 60 s floor, so the step is refused; the old rule took 0.7 * 180 = 126 s and started it,
    leaving 54 s of budget for a reserve of 90 s. With 200 s the slice is 70 s and the step runs.
    The numbers are typed here from the budget constants' documented values, not read from the
    code under test."""
    options_mock = _options_ok()
    result, payload, _ledger_mock, capture = await _run_derive(
        options_mock=options_mock,
        extra_patches=(
            patch.dict("services.job_worker.TIMEOUT_PER_KIND", {"derive_broker_dailies": budget_s}),
        ),
    )
    assert result.outcome == DispatchOutcome.DONE
    if starts:
        options_mock.assert_awaited_once()
        assert payload["options_basis"] == _F1_BASIS
    else:
        options_mock.assert_not_awaited()
        _assert_cash_oracle_with_the_caveat(payload, capture)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc",
    [DeribitTransientReadError("chart read blip"), ValueError("no raw rows")],
    ids=["transient-read-error", "bare-value-error"],
)
async def test_options_step_transient_still_retries(exc: Exception) -> None:
    """T-185-25. A transient from the options step is not a degrade: it leaves the job so the
    dispatcher retries the whole derive as before, and persists no ``key_inputs`` row (a cash
    curve written on a blip would stand in for the options curve until the next night). A bare
    ``ValueError`` (a programming error) leaves the same way. Neuter: add either class to the
    structural catch and this goes RED."""
    sink: list[dict[str, Any]] = []
    with pytest.raises(type(exc)):
        await _run_derive(options_mock=AsyncMock(side_effect=exc), capture_sink=sink)
    assert len(sink) == 1
    key_inputs = [
        name
        for name, payload, _oc in sink[0]["upserts"]
        if name == "allocator_equity_derived"
        and isinstance(payload, dict)
        and str(payload.get("kind", "")).startswith("key_inputs:")
    ]
    assert key_inputs == []


# ── Plan 185-09 Task 3: F2 (f2-a, D-07) - option days the options basis cannot value ──────────
#
# Founder F2 (2026-11-01, D-07, plan 185-09 ``f2-answer: f2-a``): a day older than the option-price
# window (smoothed: ``pre_mark_retention_option_days``) or before the summary rollout
# (mark-to-market: ``pre_coverage_option_days``) KEEPS its cash-basis return, stamped and caveated.
# The options basis still applies to the key (``options_basis`` is written), but the caveat stays
# true for as long as any option day is measured at cash value. SC-5 (never invent data): no
# bucketed day is interpolated or filled; this rule touches the caveat and nothing else.
#
# The expected values are typed here, not read from the code under test: the bucketed derive must
# persist EXACTLY the options oracle (the series the unbucketed derive persists) and carry the flag.

_BUCKET = [("USDC", "2025-07-11")]


def _bucketed_report(**lists: Any) -> CompletenessReport:
    return dataclasses.replace(_round_trip_report(), **lists)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("lists", "meta_key", "caveat"),
    [
        ({}, None, False),
        (
            {"pre_coverage_option_days": _BUCKET},
            "pre_summary_rollout_option_dailies",
            True,
        ),
    ],
    ids=["no-bucketed-days", "mark-to-market-coverage"],
)
async def test_bucketed_option_days_keep_cash_and_the_caveat(
    lists: dict[str, Any], meta_key: str | None, caveat: bool
) -> None:
    """F2 f2-a. An options report with bucketed days still applies the options basis
    (``options_basis`` present, the options oracle persisted, nothing filled), stamps the matching
    meta key, and raises ``options_cash_basis``; with both lists empty the flag is absent.
    Neuter: drop the bucketed-day term from the caveat rule -> the flag is missing -> RED."""
    metas: list[dict[str, Any]] = []

    def _recording_combine(*args: Any, **kwargs: Any) -> tuple[Any, dict[str, Any]]:
        returns, meta = combine_native_ledger(*args, **kwargs)
        metas.append(meta)  # the SAME dict the derive stamps in place
        return returns, meta

    options_mock = AsyncMock(return_value=(options_round_trip_ledger(), _bucketed_report(**lists)))
    result, payload, _ledger_mock, capture = await _run_derive(
        options_mock=options_mock,
        extra_patches=(
            patch("services.broker_dailies.combine_native_ledger", new=_recording_combine),
        ),
    )
    assert result.outcome == DispatchOutcome.DONE
    assert payload["options_basis"] == _F1_BASIS
    for got, want in zip(_persisted(capture), _ORACLE_OPTIONS, strict=True):
        assert got == pytest.approx(want, abs=_TOL)
    if caveat:
        assert payload.get("options_cash_basis") is True
        assert metas[-1][meta_key] == ["USDC:2025-07-11"]
    else:
        assert "options_cash_basis" not in payload
        assert "pre_mark_retention_option_dailies" not in metas[-1]
        assert "pre_summary_rollout_option_dailies" not in metas[-1]


# ── WR-04 (185 review round 1): the REAL options assembly through the key-mode derive ─────────
#
# Every test above hands the derive a prebuilt ledger (a mocked assembler), so none of them can
# fail on the assembly's own logic: the terminal wedge, section 5, or which option days it
# buckets. These drive ``build_deribit_options_basis_ledger`` itself, from the cash build's
# retained rows and a realistic account summary, through the derive's real combine.

_REAL_OPTIONS_BUILD = di.build_deribit_options_basis_ledger


def _btc_deposit_row(day: str, amount: float, id: int) -> dict[str, Any]:
    return {
        "type": "deposit",
        "currency": "BTC",
        "change": amount,
        "timestamp": _mk_ms(day, 9),
        "id": id,
    }


async def _real_assembly_derive(
    monkeypatch: pytest.MonkeyPatch,
    *,
    rows: list[dict[str, Any]],
    summary: dict[str, Any],
    charts: dict[str, dict[str, float]],
    options_fails: bool = False,
    extra_patches: tuple[Any, ...] = (),
) -> tuple[Any, dict[str, Any], dict[str, Any]]:
    """A key-mode derive of BTC rows whose options ledger is built by the REAL assembler.

    The cash ledger and its report (rows retained) come from the real cash build; the account
    state is the real read of ``summary``. ``options_fails`` swaps the assembler for a structural
    refusal, which is the cash fallback the same derive would otherwise degrade to."""
    _install_stubs(monkeypatch, rows)
    stub = _OptionsAdapterStub([summary], charts)
    state = await di.fetch_deribit_native_account_state(stub)
    cash_ledger, cash_report = await di.build_deribit_native_ledger(
        stub, pnl_basis="cash_settlement", retain_raw_rows=True
    )

    async def _real(_exchange: Any, **kwargs: Any) -> Any:
        return await _REAL_OPTIONS_BUILD(stub, **kwargs)

    options = (
        AsyncMock(side_effect=LedgerValuationError("forced cash fallback"))
        if options_fails
        else _real
    )
    result, payload, _mock, capture = await _run_derive(
        options_mock=options,  # type: ignore[arg-type]
        cash_ledger=cash_ledger,
        report=cash_report,
        account_state=state,
        extra_patches=extra_patches,
    )
    return result, payload, capture


def _returns_by_day(capture: dict[str, Any]) -> dict[str, float]:
    return {str(d): float(v) for d, v in _csv_returns(capture).items()}


@pytest.mark.asyncio
async def test_key_mode_real_smoothed_assembly_closes_section_5_with_session_rpl(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """CR-01 / WR-04. A funded account holding an open option book AND carrying 0.005 BTC of
    futures session RPL (perp P&L accrued since the 08:00 settlement) keeps the options basis:
    section 5 closes, ``options_basis`` is written and the caveat is not raised. Before the wedge
    carried the RPL the options step was refused in section 5 and the key fell back to cash.

    The account is hand-derived from Deribit's identity ``equity = balance + futures (session UPL
    + session RPL) + options value``: deposit 1.0, a 2-lot call bought for 0.10 and marked
    0.06 -> 0.07 -> 0.08 (settled book 0.16), balance = 1.0 - 0.10 = 0.90, futures UPL 0.01, RPL
    0.005, options value 0.18 (0.02 of it this session's move), so equity = 1.095. The options
    basis books the ΔMTM 0.02 a day on a NAV of 1.0, 1.02, 1.04 (cash would book the -0.10
    premium on day one)."""
    rows = [_btc_deposit_row("2026-01-10", 1.0, 7001), *_HELD_ROWS]
    summary = {
        "currency": "BTC", "balance": 0.90, "equity": 1.095,
        "futures_session_upl": 0.01, "session_upl": 0.01,
        "futures_session_rpl": 0.005, "session_rpl": 0.005,
        "options_value": 0.18, "options_session_upl": 0.02,
    }
    result, payload, capture = await _real_assembly_derive(
        monkeypatch, rows=rows, summary=summary, charts=_HELD_CHARTS
    )
    assert result.outcome == DispatchOutcome.DONE
    assert payload["options_basis"] == _F1_BASIS
    assert "options_cash_basis" not in payload
    got = _returns_by_day(capture)
    for day, want in (("2026-01-15", 0.02), ("2026-01-16", 0.02 / 1.02), ("2026-01-17", 0.02 / 1.04)):
        assert got[day] == pytest.approx(want, abs=1e-9)


@pytest.mark.asyncio
async def test_bucketed_days_keep_the_cash_ledgers_own_return(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SC-5, f2-a, through the REAL assembly. A funded pre-retention option round trip (the
    venue returns no marks for it) is bucketed by the assembler itself: ``options_basis`` is
    written, the meta stamps the bucketed day, the caveat stays, and the stored returns equal
    the ones the same derive stores when the options step is refused (the cash ledger's own),
    with the hand-derived -0.01 premium on 2023-06-20 (deposit 1.0) and the +0.02 payout on
    2023-06-30 (NAV 0.99). Nothing is interpolated.
    Neuter: have the assembler value or fill a bucketed day and the series moves off cash."""
    rows = [
        _btc_deposit_row("2023-06-19", 1.0, 7001),
        _opt_row(instrument=_PRE_RET_INSTR, day="2023-06-20", change=-0.01, position=1.0, id=1),
        _opt_row(
            instrument=_PRE_RET_INSTR, day="2023-06-30", change=0.02, position=0.0, id=2,
            type="delivery",
        ),
    ]
    summary = {"currency": "BTC", "balance": 1.01, "equity": 1.01, "session_upl": 0.0,
               "options_value": 0.0}
    metas: list[dict[str, Any]] = []

    def _recording_combine(*args: Any, **kwargs: Any) -> tuple[Any, dict[str, Any]]:
        returns, meta = combine_native_ledger(*args, **kwargs)
        metas.append(meta)  # the SAME dict the derive stamps in place
        return returns, meta

    recorder = patch("services.broker_dailies.combine_native_ledger", new=_recording_combine)
    result, payload, capture = await _real_assembly_derive(
        monkeypatch, rows=rows, summary=summary, charts={}, extra_patches=(recorder,)
    )
    assert result.outcome == DispatchOutcome.DONE
    assert payload["options_basis"] == _F1_BASIS
    assert payload.get("options_cash_basis") is True
    assert "BTC:2023-06-20" in metas[-1]["pre_mark_retention_option_dailies"]
    got = _returns_by_day(capture)
    assert got["2023-06-20"] == pytest.approx(-0.01, abs=1e-9)
    assert got["2023-06-30"] == pytest.approx(0.02 / 0.99, abs=1e-9)

    _result, cash_payload, cash_capture = await _real_assembly_derive(
        monkeypatch, rows=rows, summary=summary, charts={}, options_fails=True
    )
    assert "options_basis" not in cash_payload
    assert got == pytest.approx(_returns_by_day(cash_capture), abs=1e-12)