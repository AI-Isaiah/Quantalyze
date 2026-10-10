"""Phase 167.1.2.2 round-1 CR-01 — the replay rolls from the WRITER'S realized terminal,
so an open position never moves a level or the zero-start verdict.

THE DEFECT (167.1.2.2-REVIEW.md CR-01, measured by the reviewer). The two venue writers
roll their NAV back from a REALIZED terminal: MT5 from ``equity - upnl`` (the balance),
Deribit from ``terminal_native - upnl_native`` per currency, valued at the mark of the
LAST LEDGER DAY. The derive stored the LIVE equity as ``anchor_usd`` and the compose
rolled the realized-basis returns back from it. Writing ``U`` for the difference (the open
uPnL, plus on Deribit any coin mark move since the last ledger day), every historical level
was off by ``U / G(t -> T)`` and the D-13/D-15 zero-start check measured ``U`` instead of
the inception. An account that started from exactly zero read ``inception_unreconciled``
at ``U`` = 0.01% of equity, and the verdict flapped with whether a position was open when
the cron ran.

THE FIX UNDER TEST. The derive stores the realized terminal and its day
(``realized_terminal_usd`` / ``realized_terminal_day``); ``replay_key_equity`` rolls from it
when it sits on the series' last day, then puts the live anchor on that last day ONLY.

THE ORACLE IS INDEPENDENT OF THE CODE UNDER TEST. The expected levels are the navs of a
``Book`` built FORWARD in exact ``fractions.Fraction`` arithmetic from a chosen
pre-funding capital (0 for a clean account), and the realized terminal the derive must
store is that book's own last nav, not a number read back from the replay. The live equity
is the oracle's last nav plus a chosen wedge. For each case the three properties asserted
are the ones the review names: the verdict is reconciled for a true zero start at ANY
wedge, every level before the anchor day equals the true realized NAV, and the curve's
last point is the live equity.
"""
from __future__ import annotations

from fractions import Fraction

import pandas as pd
import pytest

from services.allocator_equity_derive import (
    DegradeReason,
    read_dropped_day_pnl,
    read_realized_terminal,
    realized_terminal_payload,
    replay_key_equity,
)
from services.broker_dailies import (
    combine_mt5_deal_ledger,
    combine_native_ledger,
    mt5_day_pnl,
    native_ledger_composed_flows,
    native_ledger_day_pnl,
    native_ledger_realized_terminal,
)
from services.external_flows import ExternalFlow
from services.native_nav import NativeLedger
from services.nav_twr import NavReconstructionError
from tests.test_allocator_equity_dropped_day_pnl import (
    Book,
    _compose_curve,
    _csv_returns,
    _iso,
    _key_inputs_payload,
    _mt5_deals,
    _persisted_roundtrip,
    _stored,
    funding_and_dominated_book,
    two_day_run_book,
)

# open position as a share of the realized terminal: none, far below the band, at it,
# above it, and a large one (5%). Negative wedges are exercised separately.
WEDGES = [
    Fraction(0),
    Fraction(1, 100_000),
    Fraction(1, 10_000),
    Fraction(1, 1_000),
    Fraction(1, 100),
    Fraction(1, 20),
]
_REL = Fraction(1, 10**9)


def _close(got: float, want: Fraction) -> bool:
    return abs(Fraction(got) - want) <= _REL * abs(want)


def _assert_realized_basis(book_nav: list[Fraction], days: list[str], ke, live: float) -> None:
    """The three review properties, against the oracle's exact navs."""
    assert ke.equity is not None
    # (a) reconciled: a true zero start is never blocked by a wedge
    assert ke.degrade_reasons == frozenset(), sorted(r.value for r in ke.degrade_reasons)
    assert ke.is_trustworthy is True
    assert "inception_unreconciled_flows" not in ke.flags
    assert ke.flags.get("opening_flows_reconciled", 0) >= 1
    # (b) every level BEFORE the anchor day is the true realized NAV
    for i, day in enumerate(days[:-1]):
        assert _close(float(ke.equity[day]), book_nav[i]), (day, float(ke.equity[day]), float(book_nav[i]))
    # (c) the curve's last point is the live equity, exactly
    assert float(ke.equity[days[-1]]) == live


# ── 1. MT5: equity != balance, through the real combine and the real day-P&L ─────


def _mt5_replay(book: Book, wedge: Fraction):
    nav_t = book.nav[-1]
    upnl = wedge * nav_t
    balance, equity = float(nav_t), float(nav_t + upnl)
    deals = _mt5_deals(book)
    returns, _ = combine_mt5_deal_ledger(deals, account_equity=equity, account_balance=balance)
    day_pnl = mt5_day_pnl(deals)
    stored = _persisted_roundtrip(returns, day_pnl)
    # the terminal the derive must store is the ORACLE's last nav (the balance), on the
    # last NAV day: not the live equity, and not read back from the replay
    payload = realized_terminal_payload(day_pnl.index[-1], float(nav_t))
    ke = replay_key_equity(
        _stored(returns),
        book.flows,
        equity,
        history_reaches_inception=True,
        dropped_day_pnl=stored,
        realized_terminal=read_realized_terminal(payload),
    )
    return ke, equity


@pytest.mark.parametrize("wedge", WEDGES, ids=lambda w: f"U={float(w):g}")
@pytest.mark.parametrize(
    "book_fn", [funding_and_dominated_book, two_day_run_book], ids=["funding+dominated", "two-day-run"]
)
def test_mt5_zero_start_reconciles_at_any_open_upnl(book_fn, wedge: Fraction) -> None:
    book = book_fn()
    assert book.c0 == 0 and book.nav[-1] > 0
    ke, equity = _mt5_replay(book, wedge)
    _assert_realized_basis(book.nav, book.days, ke, equity)


@pytest.mark.parametrize("wedge", [Fraction(-1, 100), Fraction(-1, 10_000)], ids=["U=-1%", "U=-0.01%"])
def test_a_losing_open_position_is_no_different(wedge: Fraction) -> None:
    book = funding_and_dominated_book()
    ke, equity = _mt5_replay(book, wedge)
    assert equity < float(book.nav[-1])
    _assert_realized_basis(book.nav, book.days, ke, equity)


def test_the_verdict_and_the_early_levels_do_not_depend_on_the_wedge() -> None:
    """Independence, stated directly: every wedge gives the SAME levels before the anchor
    day and the SAME flags as no open position at all. This is what makes the cron's
    verdict stop flapping with whether a position happens to be open."""
    book = funding_and_dominated_book()
    base, _ = _mt5_replay(book, Fraction(0))
    for wedge in WEDGES[1:]:
        other, _ = _mt5_replay(book, wedge)
        assert other.flags == base.flags
        assert other.degrade_reasons == base.degrade_reasons
        for day in book.days[:-1]:
            assert float(other.equity[day]) == pytest.approx(float(base.equity[day]), rel=1e-12), day


@pytest.mark.parametrize(
    ("c0", "blocks"), [(Fraction(9), False), (Fraction(40), True), (Fraction(-20000), True)]
)
@pytest.mark.parametrize("wedge", [Fraction(0), Fraction(1, 100), Fraction(-1, 100)], ids=lambda w: f"U={float(w):g}")
def test_genuinely_missing_start_capital_still_blocks_at_any_wedge(
    c0: Fraction, blocks: bool, wedge: Fraction
) -> None:
    """The check keeps its teeth, and on the writer's basis it no longer matters whether
    the wedge happens to cancel (or add to) the real residual. c0 = 40 is ~2.1x the band
    and c0 = 9 is ~0.47x of it; neither verdict moves with the wedge."""
    book = funding_and_dominated_book(c0)
    ke, _ = _mt5_replay(book, wedge)
    if blocks:
        assert ke.degrade_reasons == frozenset({DegradeReason.INCEPTION_UNRECONCILED})
        assert ke.flags["inception_unreconciled_flows"] == 1
    else:
        assert ke.degrade_reasons == frozenset()
        assert ke.flags["opening_flows_reconciled"] == 1


# ── 2. Deribit: non-empty terminal_upnl_native ───────────────────────────────


def _usdc_ledger(book: Book, wedge: Fraction) -> tuple[NativeLedger, float]:
    nav_t = book.nav[-1]
    upnl = wedge * nav_t
    pnl = pd.Series(
        [float(p) for p in book.pnl],
        index=pd.DatetimeIndex([pd.Timestamp(d) for d in book.days]),
        name="native_pnl",
    )
    ledger = NativeLedger(
        native_pnl={"USDC": pnl},
        # the venue reports TOTAL equity (balance + open uPnL); the writer subtracts the
        # uPnL, so it rolls from the oracle's last nav
        terminal_native_equity={"USDC": float(nav_t + upnl)},
        marks={},
        native_flows=[
            ExternalFlow(_iso(i), float(f), "USDC", float(f)) for i, f in enumerate(book.flow) if f != 0
        ],
        terminal_upnl_native={"USDC": float(upnl)} if upnl != 0 else {},
        full_history=True,
    )
    return ledger, float(nav_t + upnl)


def _deribit_replay(ledger: NativeLedger, indexable: frozenset[str], flows, live: float):
    returns, _ = combine_native_ledger(ledger, indexable)
    day_pnl = native_ledger_day_pnl(ledger, indexable)
    terminal = native_ledger_realized_terminal(ledger, indexable)
    assert terminal is not None
    payload = realized_terminal_payload(*terminal)
    ke = replay_key_equity(
        _stored(returns),
        flows,
        live,
        history_reaches_inception=True,
        dropped_day_pnl=_persisted_roundtrip(returns, day_pnl),
        realized_terminal=read_realized_terminal(payload),
    )
    return ke, terminal


@pytest.mark.parametrize("wedge", WEDGES + [Fraction(-1, 100)], ids=lambda w: f"U={float(w):g}")
@pytest.mark.parametrize(
    "book_fn", [funding_and_dominated_book, two_day_run_book], ids=["funding+dominated", "two-day-run"]
)
def test_deribit_zero_start_reconciles_with_a_terminal_upnl(book_fn, wedge: Fraction) -> None:
    book = book_fn()
    ledger, live = _usdc_ledger(book, wedge)
    ke, terminal = _deribit_replay(ledger, frozenset(), book.flows, live)

    # the terminal the derive stores is the ORACLE's last nav on the last NAV day
    assert terminal[0] == pd.Timestamp(book.days[-1])
    assert _close(terminal[1], book.nav[-1])
    _assert_realized_basis(book.nav, book.days, ke, live)


# ── 3. Deribit coin-margined: the live index differs from the last ledger mark ───


def _btc_book():
    """A zero-start BTC-margined account, marks moving every day, built forward in
    exact arithmetic. Returns the native pnl/flow lists, marks and the exact USD navs."""
    q_pnl = [Fraction(-1, 64), Fraction(-3, 64), Fraction(5, 64)] + [
        Fraction(k, 64) for k in (2, -3, 4, -1, 5, -2, 3, 1, -4, 2, -1, 3, 2, -2, 1)
    ]
    q_flow = [Fraction(4), Fraction(0), Fraction(9)] + [Fraction(0)] * 15
    marks = [Fraction(m) for m in (
        50000, 50800, 49500, 51200, 50100, 52300, 51700, 50900, 53100, 52400,
        51000, 52800, 53500, 52100, 51300, 54000, 53200, 52600,
    )]
    bal: list[Fraction] = []
    b = Fraction(0)
    for qp, qf in zip(q_pnl, q_flow):
        b = b + qp + qf
        bal.append(b)
    nav = [bal[i] * marks[i] for i in range(len(q_pnl))]
    return q_pnl, q_flow, marks, bal, nav


@pytest.mark.parametrize(
    ("upnl_btc", "drift"),
    [
        (Fraction(0), Fraction(1)),  # nothing open, index unmoved
        (Fraction(1, 1000), Fraction(1)),  # an open position
        (Fraction(0), Fraction(101, 100)),  # index +1% since the last ledger day
        (Fraction(0), Fraction(11, 10)),  # index +10%
        (Fraction(1, 1000), Fraction(105, 100)),  # both
        (Fraction(-1, 1000), Fraction(95, 100)),  # a losing position and a falling index
    ],
    ids=["flat", "upnl", "index+1%", "index+10%", "upnl+index+5%", "loss+index-5%"],
)
def test_coin_margined_live_index_differs_from_the_last_ledger_mark(
    upnl_btc: Fraction, drift: Fraction
) -> None:
    q_pnl, q_flow, marks, bal, nav = _btc_book()
    n = len(q_pnl)
    idx = pd.DatetimeIndex([pd.Timestamp(_iso(i)) for i in range(n)])
    flow_usd = [q_flow[i] * marks[i] for i in range(n)]
    ledger = NativeLedger(
        native_pnl={"BTC": pd.Series([float(x) for x in q_pnl], index=idx)},
        terminal_native_equity={"BTC": float(bal[-1] + upnl_btc)},
        marks={"BTC": pd.Series([float(m) for m in marks], index=idx)},
        native_flows=[
            ExternalFlow(_iso(i), float(flow_usd[i]), "BTC", float(q_flow[i]))
            for i in range(n)
            if q_flow[i] != 0
        ],
        terminal_upnl_native={"BTC": float(upnl_btc)} if upnl_btc != 0 else {},
        full_history=True,
    )
    # the collapsed live equity, read 'today' at an index that has moved since the last
    # ledger day: coin held (balance + open uPnL) at drift x the last ledger mark
    live = float((bal[-1] + upnl_btc) * marks[-1] * drift)
    flows = [ExternalFlow(_iso(i), float(flow_usd[i])) for i in range(n) if q_flow[i] != 0]
    ke, terminal = _deribit_replay(ledger, frozenset({"BTC"}), flows, live)

    # the writer's terminal is the REALIZED coin balance at the LAST LEDGER DAY's mark: the
    # oracle's last nav, whatever the index and the open position are now
    assert terminal[0] == pd.Timestamp(_iso(n - 1))
    assert _close(terminal[1], nav[-1])
    if upnl_btc != 0 or drift != 1:
        assert abs(Fraction(live) - nav[-1]) > nav[-1] / 100_000  # the wedge is real
    _assert_realized_basis(nav, [_iso(i) for i in range(n)], ke, live)


# ── 4. rows and readers ──────────────────────────────────────────────────────


def test_an_old_row_without_the_terminal_rolls_from_the_anchor_as_before() -> None:
    """No field -> today's behaviour, byte for byte. That behaviour is the CR-01 defect
    (the wedge shifts the levels and flaps the verdict), so it is pinned here as what an
    old row does, not as something to want: the next derive of the key rewrites the row."""
    book = funding_and_dominated_book()
    returns, _ = combine_mt5_deal_ledger(
        _mt5_deals(book), account_equity=float(book.nav[-1]) * 1.01, account_balance=book.anchor
    )
    stored = _persisted_roundtrip(returns, mt5_day_pnl(_mt5_deals(book)))
    args = (_stored(returns), book.flows, float(book.nav[-1]) * 1.01)
    absent = replay_key_equity(*args, history_reaches_inception=True, dropped_day_pnl=stored)
    none = replay_key_equity(
        *args, history_reaches_inception=True, dropped_day_pnl=stored, realized_terminal=None
    )
    assert list(none.equity) == list(absent.equity)
    assert none.flags == absent.flags
    assert absent.degrade_reasons == frozenset({DegradeReason.INCEPTION_UNRECONCILED})
    assert _close(float(absent.equity[book.days[0]]), book.nav[0]) is False  # shifted by U/G


def test_no_wedge_makes_the_terminal_a_no_op() -> None:
    """With nothing open the realized terminal IS the anchor; the result equals the
    anchor-only replay exactly."""
    book = funding_and_dominated_book()
    with_t = replay_key_equity(
        book.stored_returns, book.flows, book.anchor, history_reaches_inception=True,
        dropped_day_pnl=book.dropped_pnl, realized_terminal=(book.days[-1], book.anchor),
    )
    without = replay_key_equity(
        book.stored_returns, book.flows, book.anchor, history_reaches_inception=True,
        dropped_day_pnl=book.dropped_pnl,
    )
    assert list(with_t.equity) == list(without.equity)
    assert with_t.flags == without.flags


def test_a_terminal_that_is_not_on_the_last_day_is_a_mismatch_not_a_guess() -> None:
    """The row and the returns come from different derive runs (the two writes are not
    atomic). The roll falls back to the anchor, the key degrades under the honest name,
    and the flag says why."""
    book = funding_and_dominated_book()
    for wrong_day in ("2026-01-01", book.days[-2], "2027-01-01"):
        ke = replay_key_equity(
            book.stored_returns, book.flows, book.anchor, history_reaches_inception=True,
            dropped_day_pnl=book.dropped_pnl, realized_terminal=(wrong_day, 123.0),
        )
        assert DegradeReason.KEY_INPUTS_MISMATCH in ke.degrade_reasons
        assert ke.is_trustworthy is False
        assert ke.flags["realized_terminal_day_mismatch"] is True
        # the levels are the anchor-basis ones (the wrong terminal was not used)
        assert float(ke.equity[book.days[-1]]) == book.anchor


def test_the_live_anchor_must_still_be_positive() -> None:
    book = funding_and_dominated_book()
    with pytest.raises(NavReconstructionError):
        replay_key_equity(
            book.stored_returns, book.flows, -5.0, history_reaches_inception=True,
            dropped_day_pnl=book.dropped_pnl, realized_terminal=(book.days[-1], book.anchor),
        )


def test_a_non_finite_realized_terminal_is_refused() -> None:
    book = funding_and_dominated_book()
    for bad in (float("nan"), float("inf")):
        with pytest.raises(NavReconstructionError):
            replay_key_equity(
                book.stored_returns, book.flows, book.anchor, history_reaches_inception=True,
                dropped_day_pnl=book.dropped_pnl, realized_terminal=(book.days[-1], bad),
            )
        with pytest.raises(NavReconstructionError):
            realized_terminal_payload("2026-02-01", bad)


def test_the_reader_gives_none_for_an_old_row_and_raises_on_a_malformed_one() -> None:
    assert read_realized_terminal({"flows": [], "anchor_usd": 1.0}) is None
    assert read_realized_terminal(
        {"realized_terminal_day": None, "realized_terminal_usd": None}
    ) is None
    assert read_realized_terminal(
        {"realized_terminal_day": "2026-02-03", "realized_terminal_usd": 12}
    ) == ("2026-02-03", 12.0)
    for bad in (
        {"realized_terminal_day": "2026-02-03"},  # the pair travels together
        {"realized_terminal_usd": 5.0},
        {"realized_terminal_day": "2026-02-03", "realized_terminal_usd": True},
        {"realized_terminal_day": "2026-02-03", "realized_terminal_usd": "5"},
        {"realized_terminal_day": "2026-02-03", "realized_terminal_usd": float("nan")},
        {"realized_terminal_day": "2026-02-03", "realized_terminal_usd": float("inf")},
        {"realized_terminal_day": "not-a-day", "realized_terminal_usd": 5.0},
    ):
        with pytest.raises((ValueError, TypeError)):
            read_realized_terminal(bad)


def test_the_payload_day_is_the_iso_day_of_the_nav_timestamp() -> None:
    assert realized_terminal_payload(pd.Timestamp("2026-03-04"), 7.5) == {
        "realized_terminal_usd": 7.5,
        "realized_terminal_day": "2026-03-04",
    }


# ── 5. the derive epilogue writes it, per venue, from the real writers ───────


@pytest.mark.asyncio
@pytest.mark.parametrize("wedge", [Fraction(0), Fraction(1, 10_000), Fraction(1, 100)], ids=lambda w: f"U={float(w):g}")
async def test_mt5_key_mode_stores_the_balance_and_the_compose_reads_it_back(monkeypatch, wedge) -> None:
    """MT5 through the whole key-mode derive job with equity != balance. The stored
    realized terminal is the ORACLE's last nav (the balance), on the last NAV day; the live
    equity stays ``anchor_usd``; replaying the persisted rows gives the three properties."""
    import services.mt5_concurrency as mt5_conc
    from unittest.mock import AsyncMock, patch

    from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
    from tests.test_mt5_derive_branch import (
        _apply,
        _build_ctx as _mt5_build_ctx,
        _FakeMt5Transport,
    )

    monkeypatch.setenv("MT5_ENABLED", "true")
    book = funding_and_dominated_book()
    nav_t = book.nav[-1]
    equity = float(nav_t + wedge * nav_t)
    transport = _FakeMt5Transport(
        account={"equity": equity, "balance": float(nav_t), "currency": "USD", "login": 123456},
        deals=_mt5_deals(book),
    )
    ctx, capture = _mt5_build_ctx(transport)
    ctx.strategy_row = None
    mt5_conc.reset_terminal_state_for_tests()
    try:
        with _apply([
            patch("services.job_worker._allocator_key_preflight", new=AsyncMock(return_value=ctx)),
            patch("services.job_worker.aclose_exchange", new=AsyncMock()),
            patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        ]):
            result = await run_derive_broker_dailies_job(
                {"id": "j-mt5-wedge", "kind": "derive_broker_dailies", "api_key_id": "key-mt5"}
            )
    finally:
        mt5_conc.reset_terminal_state_for_tests()

    assert result.outcome == DispatchOutcome.DONE
    payload = _key_inputs_payload(capture, "key-mt5")
    assert payload["anchor_usd"] == equity  # the live equity is still what is displayed
    assert payload["realized_terminal_day"] == book.days[-1]
    assert _close(payload["realized_terminal_usd"], nav_t)

    ke = replay_key_equity(
        _csv_returns(capture),
        [ExternalFlow(f["utc_day_iso"], f["usd_signed"]) for f in payload["flows"]],
        payload["anchor_usd"],
        history_reaches_inception=True,
        dropped_day_pnl=read_dropped_day_pnl(payload),
        realized_terminal=read_realized_terminal(payload),
    )
    _assert_realized_basis(book.nav, book.days, ke, equity)


@pytest.mark.asyncio
@pytest.mark.parametrize("wedge", [Fraction(0), Fraction(1, 100)], ids=lambda w: f"U={float(w):g}")
async def test_deribit_key_mode_stores_the_realized_terminal_from_the_real_ledger(wedge) -> None:
    """Deribit through the whole key-mode job with the REAL combine / day-P&L / terminal
    functions on a ledger that carries a terminal uPnL (the helpers' patches that stub
    them for the other tests are overridden)."""
    from unittest.mock import AsyncMock, MagicMock, patch

    from services.deribit_ingest import DeribitNativeAccountState
    from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
    from tests.test_mtm_single_key import _apply, _base_patches, _ctx, _ledger_meta, _report

    book = funding_and_dominated_book()
    ledger, live = _usdc_ledger(book, wedge)
    returns, _ = combine_native_ledger(ledger, frozenset())
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    state = DeribitNativeAccountState(
        native_equity={"USDC": live},
        native_upnl={"USDC": live - float(book.nav[-1])},
        collapsed_equity_usd=live,
        collapsed_upnl_usd=live - float(book.nav[-1]),
        balance_error=False,
        upnl_unreadable=False,
        native_options_value={},
    )
    patches = _base_patches(
        ctx,
        key_mode=True,
        ledger_mock=AsyncMock(return_value=(ledger, _report(has_option_activity=False))),
        combine_mock=MagicMock(return_value=(returns, _ledger_meta())),
        state_spy=AsyncMock(return_value=state),
    ) + [
        patch("services.broker_dailies.native_ledger_day_pnl", new=native_ledger_day_pnl),
        patch(
            "services.broker_dailies.native_ledger_realized_terminal",
            new=native_ledger_realized_terminal,
        ),
        patch(
            "services.broker_dailies.native_ledger_composed_flows",
            new=native_ledger_composed_flows,
        ),
    ]
    with _apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j-drb-wedge", "kind": "derive_broker_dailies", "api_key_id": "key-drb"}
        )

    assert result.outcome == DispatchOutcome.DONE
    payload = _key_inputs_payload(capture, "key-drb")
    assert payload["anchor_usd"] == live
    assert payload["realized_terminal_day"] == book.days[-1]
    assert _close(payload["realized_terminal_usd"], book.nav[-1])

    ke = replay_key_equity(
        _stored(returns),
        book.flows,
        payload["anchor_usd"],
        history_reaches_inception=True,
        dropped_day_pnl=read_dropped_day_pnl(payload),
        realized_terminal=read_realized_terminal(payload),
    )
    _assert_realized_basis(book.nav, book.days, ke, live)


# ── 6. the compose JOB: the stored terminal reaches the replay ───────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("wedge", [Fraction(1, 10_000), Fraction(1, 100)], ids=lambda w: f"U={float(w):g}")
async def test_the_compose_job_rolls_from_the_stored_terminal(wedge) -> None:
    """A key_inputs row carrying the realized terminal, with a live equity above it: the
    compose job's curve is the oracle's realized navs, ends on the live equity, and is
    trustworthy. The same row WITHOUT the fields is the old behaviour (untrustworthy,
    levels shifted): the fields are what change it."""
    book = funding_and_dominated_book()
    live = float(book.nav[-1] + wedge * book.nav[-1])
    ki = {
        "realized_terminal_usd": book.anchor,
        "realized_terminal_day": book.days[-1],
    }
    payload = await _compose_curve(book, with_pnl=True, anchor=live, ki_extra=ki)

    assert payload["degrade_reasons"] == []
    assert payload["is_trustworthy"] is True
    curve = {row["date"]: row["equity_usd"] for row in payload["curve"]}
    for i, day in enumerate(book.days[:-1]):
        assert _close(curve[day], book.nav[i]), day
    assert curve[book.days[-1]] == live

    old = await _compose_curve(book, with_pnl=True, anchor=live)
    assert old["degrade_reasons"] == ["inception_unreconciled"]
    old_curve = {row["date"]: row["equity_usd"] for row in old["curve"]}
    assert not _close(old_curve[book.days[0]], book.nav[0])  # shifted by U / G


@pytest.mark.asyncio
async def test_the_compose_job_flags_a_terminal_from_another_run() -> None:
    book = funding_and_dominated_book()
    ki = {"realized_terminal_usd": book.anchor, "realized_terminal_day": book.days[-2]}
    # The returns run past the terminal's day: on a non-final attempt that is retried as a
    # read race (test_allocator_equity_compose_read_race.py). On the last attempt it is a
    # genuine mismatch, and this is its loud verdict.
    payload = await _compose_curve(
        book, with_pnl=True, ki_extra=ki, job_extra={"attempts": 3, "max_attempts": 3}
    )
    assert "key_inputs_mismatch" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False


@pytest.mark.asyncio
async def test_the_compose_job_disposes_a_malformed_terminal_as_a_corrupt_input() -> None:
    from unittest.mock import patch

    from services.job_worker import run_derive_allocator_equity_job
    from tests.test_derive_allocator_equity_job import DERIVED_TABLE, _FakeSupabase

    book = funding_and_dominated_book()
    alloc = "alloc-bad-terminal"
    fake = _FakeSupabase({
        "api_keys": [{
            "id": "key-D", "user_id": alloc, "is_active": True, "sync_status": "connected",
            "disconnected_at": None, "exchange": "deribit",
        }],
        "csv_daily_returns": [
            {"api_key_id": "key-D", "allocator_id": alloc, "date": d, "daily_return": r}
            for d, r in book.stored_returns.items()
        ],
        DERIVED_TABLE: [{"allocator_id": alloc, "kind": "key_inputs:key-D", "payload": {
            "flows": [], "anchor_usd": book.anchor, "anchor_null_reason": None,
            "anchor_asof": f"{book.days[-1]}T06:00:00+00:00", "venue": "deribit",
            "realized_terminal_day": book.days[-1], "realized_terminal_usd": True,
        }}],
        "allocator_equity_snapshots": [],
    })
    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(
            {"id": "j-bad", "kind": "derive_allocator_equity", "allocator_id": alloc}
        )
    assert result.outcome.name == "FAILED"
    assert result.error_kind == "permanent"


@pytest.mark.asyncio
async def test_a_departed_keys_realized_terminal_is_read_and_its_levels_exclude_the_wedge() -> None:
    """A disconnected key's history is replayed from its SAVED inputs. Its saved terminal
    must reach that replay too: levels before its last day are the realized ones
    (anchor-free, independently computed by the departed suite's own closed form), and
    its last day carries its saved live equity."""
    from tests.test_allocator_equity_departed import (
        ALLOC,
        DAYS,
        DEP_ANCHOR,
        DEP_R,
        _book,
        _curve,
        _level,
        _live_and_departed,
        _live_level,
        _run,
    )
    from tests.test_derive_allocator_equity_job import DERIVED_TABLE, _gate_key

    dep_days = DAYS[:10]
    departed = _gate_key(
        "key-D", ALLOC, venue_account_id="acct-departed",
        disconnected_at="2026-06-10T15:30:00+00:00",
    )
    fake = _live_and_departed(departed, dep_days)
    live_dep = DEP_ANCHOR * 1.02
    for row in fake.rows[DERIVED_TABLE]:
        if row["kind"] == "key_inputs:key-D":
            row["payload"]["anchor_usd"] = live_dep
            row["payload"]["realized_terminal_usd"] = DEP_ANCHOR
            row["payload"]["realized_terminal_day"] = dep_days[-1]
    assert (await _run(fake)).outcome.name == "DONE"
    got = _curve(_book(fake))

    for k, day in enumerate(dep_days[:-1]):
        want = _live_level(day) + _level(DEP_ANCHOR, DEP_R, len(dep_days) - 1 - k)
        assert got[day] == pytest.approx(want, rel=1e-12), day
    assert got[dep_days[-1]] == pytest.approx(_live_level(dep_days[-1]) + live_dep, rel=1e-12)


@pytest.mark.asyncio
async def test_a_stitched_accounts_terminal_is_the_counted_keys() -> None:
    """The account's terminal is the counted (newest) key M's. The older member H is not
    the account's last day, so nothing of H's is used as a terminal."""
    from tests.test_derive_allocator_equity_job import (
        _ROTATION_NEW_DAYS,
        DERIVED_TABLE,
        MARKED_ANCHOR,
        _composed_payload,
        _expected_stitched_curve,
        _rotation_pair,
        _run_gate,
    )

    alloc = "alloc-stitch-terminal"
    fake = _rotation_pair(alloc, "duplicate")
    live = MARKED_ANCHOR * 1.02
    for row in fake.rows[DERIVED_TABLE]:
        if row["kind"] == "key_inputs:key-M":
            row["payload"]["anchor_usd"] = live
            row["payload"]["realized_terminal_usd"] = MARKED_ANCHOR
            row["payload"]["realized_terminal_day"] = _ROTATION_NEW_DAYS[-1]
        if row["kind"] == "key_inputs:key-H":
            # a stale source row; its own terminal is not the account's and must not be used
            row["payload"]["realized_terminal_usd"] = 1.0
            row["payload"]["realized_terminal_day"] = "2026-05-02"
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)

    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    got = [(row["date"], row["equity_usd"]) for row in payload["curve"]]
    expected = _expected_stitched_curve([])
    assert [d for d, _ in got] == [d for d, _ in expected]
    for (day, value), (_, want) in list(zip(got, expected))[:-1]:
        assert value == pytest.approx(want, rel=1e-9), day
    assert got[-1][1] == pytest.approx(live, rel=1e-12)


# ── 7. R2-WR-02: the ccxt key-mode path (OKX) stores its realized terminal ───
#
# THE DEFECT (167.1.2.2-REVIEW.md round 2, R2-WR-02). The ccxt key-mode combine subtracts
# the real open uPnL ``U`` from the anchor before it rolls back (OKX; Bybit and Binance
# pass 0.0), so the stored returns are on the realized basis, but the derive stored no
# realized terminal. The compose therefore rolled them back from the LIVE equity and every
# level before the anchor day came out off by ``U / G(t -> T)`` (those levels are also the
# D-06 book-return weights). The fix stores ``equity - U`` on the last NAV day, exactly the
# expression ``reconstruct_nav_and_twr`` rolls from.
#
# THE ORACLE: an ordinary account (a chosen 50,000 of capital before day 0, small daily P&L
# and a few small flows) built FORWARD in exact ``Fraction`` arithmetic. The terminal the
# derive must store is the oracle's last nav, and the levels are the oracle's navs; neither
# is read back from the code under test.


def _ordinary_book() -> Book:
    from tests.test_allocator_equity_dropped_day_pnl import _window_flow, _window_pnl

    book = Book(Fraction(50_000), _window_pnl(30), _window_flow(30))
    assert book.dropped_idx == []  # every day has a return: a retention-window account
    return book


def _assert_levels(book: Book, ke, live: float) -> None:
    """Every level before the anchor day is the oracle's realized nav; the last is live."""
    assert ke.equity is not None
    for i, day in enumerate(book.days[:-1]):
        assert _close(float(ke.equity[day]), book.nav[i]), (day, float(ke.equity[day]), float(book.nav[i]))
    assert float(ke.equity[book.days[-1]]) == live


def _daily_pnl_records(book: Book) -> list[dict]:
    from tests.test_derive_broker_dailies_dualmode import _daily_pnl_record

    return [_daily_pnl_record(book.days[i], float(p)) for i, p in enumerate(book.pnl)]


async def _run_ccxt_key_mode(
    book: Book, *, venue: str, equity: float, upnl: float, realized=None, combine=None
):
    """The whole key-mode derive job on a ccxt venue, through the REAL
    ``combine_realized_and_funding`` (unless ``combine`` replaces it), with the equity read
    stubbed to ``(equity, no error, upnl)``. Returns ``(result, capture)``."""
    import pandas as _pd
    from unittest.mock import AsyncMock, MagicMock, patch

    from services.job_worker import run_derive_broker_dailies_job
    from tests.test_derive_broker_dailies_dualmode import _build_ctx

    ctx, capture = _build_ctx(
        key_row={"id": "key-ccxt", "exchange": venue, "user_id": "alloc-ccxt"},
        strategy_row=None,
    )
    patches = [
        patch("services.job_worker._allocator_key_preflight", new=AsyncMock(return_value=ctx)),
        patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=_daily_pnl_records(book) if realized is None else realized),
        ),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(equity, False, upnl, False)),
        ),
        patch("services.funding_fetch.fetch_funding_okx", new=AsyncMock(return_value=[])),
        patch("services.funding_fetch.fetch_funding_bybit", new=AsyncMock(return_value=[])),
        patch("services.funding_fetch.fetch_funding_binance", new=AsyncMock(return_value=[])),
        patch("services.ccxt_flow_fetch.fetch_ccxt_transfers", new=AsyncMock(return_value=[])),
        patch("services.job_worker._resolve_ccxt_flow_price_index", new=AsyncMock(return_value={})),
        patch("services.ccxt_flows.ccxt_rows_to_dated_flows", new=MagicMock(return_value=book.flows)),
        # The book is dated in February 2026; the retention window is a different test.
        patch("services.nav_twr.flow_coverage_terminus_day", new=MagicMock(return_value=None)),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
    ]
    if combine is not None:
        patches.append(patch("services.broker_dailies.combine_realized_and_funding", new=combine))
    stack = __import__("contextlib").ExitStack()
    for p in patches:
        stack.enter_context(p)
    with stack:
        result = await run_derive_broker_dailies_job(
            {"id": "j-ccxt", "kind": "derive_broker_dailies", "api_key_id": "key-ccxt"}
        )
    return result, capture


@pytest.mark.asyncio
@pytest.mark.parametrize("wedge", [Fraction(1, 10_000), Fraction(1, 100), Fraction(1, 20), Fraction(-1, 100)],
                         ids=lambda w: f"U={float(w):g}")
async def test_okx_key_mode_stores_the_realized_terminal_and_the_replay_rolls_from_it(wedge) -> None:
    """OKX through the whole key-mode derive with a real open-position wedge. The stored
    terminal is the ORACLE's last nav on the last NAV day, the live equity stays the anchor,
    and replaying the persisted rows gives the oracle's navs before the anchor day."""
    from services.job_worker import DispatchOutcome

    book = _ordinary_book()
    nav_t = book.nav[-1]
    upnl = wedge * nav_t
    equity = float(nav_t + upnl)
    result, capture = await _run_ccxt_key_mode(book, venue="okx", equity=equity, upnl=float(upnl))

    assert result.outcome == DispatchOutcome.DONE
    payload = _key_inputs_payload(capture, "key-ccxt")
    assert payload["anchor_usd"] == equity  # the live equity is still what is displayed
    assert payload["realized_terminal_day"] == book.days[-1]
    assert _close(payload["realized_terminal_usd"], nav_t)

    returns = _csv_returns(capture)
    flows = [ExternalFlow(f["utc_day_iso"], f["usd_signed"]) for f in payload["flows"]]
    ke = replay_key_equity(
        returns, flows, payload["anchor_usd"], history_reaches_inception=False,
        dropped_day_pnl=read_dropped_day_pnl(payload),
        realized_terminal=read_realized_terminal(payload),
    )
    assert ke.degrade_reasons == frozenset()
    _assert_levels(book, ke, equity)

    # The same persisted rows WITHOUT the fields are what the compose did before the fix:
    # every earlier level is shifted by about U / G, far beyond the oracle's tolerance.
    old = replay_key_equity(
        returns, flows, payload["anchor_usd"], history_reaches_inception=False,
    )
    assert not _close(float(old.equity[book.days[0]]), book.nav[0])


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", ["bybit", "binance"])
async def test_a_ccxt_key_with_no_open_wedge_stores_no_terminal(venue) -> None:
    """Bybit and Binance read a realized-basis balance (wedge 0.0): the replay already rolls
    from the anchor, which IS the terminal, so nothing is added to disagree with the returns."""
    book = _ordinary_book()
    result, capture = await _run_ccxt_key_mode(
        book, venue=venue, equity=float(book.nav[-1]), upnl=0.0
    )
    assert result.outcome.name == "DONE"
    payload = _key_inputs_payload(capture, "key-ccxt")
    assert "realized_terminal_usd" not in payload and "realized_terminal_day" not in payload
    ke = replay_key_equity(
        _csv_returns(capture),
        [ExternalFlow(f["utc_day_iso"], f["usd_signed"]) for f in payload["flows"]],
        payload["anchor_usd"], history_reaches_inception=False,
    )
    _assert_levels(book, ke, float(book.nav[-1]))


@pytest.mark.asyncio
async def test_a_ccxt_key_whose_last_nav_day_has_no_stored_return_stores_no_terminal(caplog) -> None:
    """A last day the TWR drops is not a csv row, so a terminal stored on it would be a
    different day from the compose's last day and read ``key_inputs_mismatch`` for a reason
    that is not a race. It is left out, and the derive says so."""
    import logging

    book = Book(Fraction(50_000), _ordinary_book().pnl[:-1] + [Fraction(900_000)], _ordinary_book().flow)
    assert book.dropped_idx == [len(book.pnl) - 1]  # the oracle: the last day's P&L dominates
    nav_t = book.nav[-1]
    with caplog.at_level(logging.WARNING, logger="services.job_worker"):
        result, capture = await _run_ccxt_key_mode(
            book, venue="okx", equity=float(nav_t * Fraction(101, 100)), upnl=float(nav_t / 100)
        )
    assert result.outcome.name == "DONE"
    payload = _key_inputs_payload(capture, "key-ccxt")
    assert "realized_terminal_usd" not in payload
    assert any("realized terminal not stored" in r.getMessage() for r in caplog.records)
    assert not any(book.days[-1] in r.getMessage() for r in caplog.records)  # no day, no USD


@pytest.mark.asyncio
async def test_a_non_positive_ccxt_terminal_is_not_stored() -> None:
    """``equity - upnl <= 0`` would make the replay refuse the WHOLE allocator (a permanent
    ``NavReconstructionError``); one key keeps the older-row behaviour instead."""
    from unittest.mock import MagicMock

    book = _ordinary_book()
    combine = MagicMock(return_value=(
        pd.Series([0.001] * 3, index=pd.date_range(book.days[0], periods=3, freq="D").as_unit("us")),
        {"used_heuristic_capital": False, "series_completeness": "fill_derived_unproven"},
    ))
    result, capture = await _run_ccxt_key_mode(
        book, venue="okx", equity=5_000.0, upnl=6_000.0, combine=combine
    )
    assert result.outcome.name == "DONE"
    payload = _key_inputs_payload(capture, "key-ccxt")
    assert payload["anchor_usd"] == 5_000.0
    assert "realized_terminal_usd" not in payload


def test_sfox_has_no_open_wedge_so_writer_and_replay_already_share_one_level() -> None:
    """The review asked whether sFOX has the OKX shape. It does not: its NAV is the OBSERVED
    ``usd_value`` series, the anchor is that series' last point and ``open_unrealized_usd``
    is 0.0, so nothing is subtracted anywhere. Pinned as an invariant: the real sFOX combine
    on the oracle's navs, replayed from the last navs with NO terminal, gives the navs."""
    from services.broker_dailies import combine_sfox_balance_history

    book = _ordinary_book()
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in book.days]).as_unit("us")
    usd_value = pd.Series([float(x) for x in book.nav], index=index, name="usd_value")
    flows = pd.Series(
        {pd.Timestamp(f.utc_day_iso).as_unit("us"): f.usd_signed for f in book.flows}, name="flows"
    ).sort_index()
    returns, _ = combine_sfox_balance_history(usd_value, flows)

    ke = replay_key_equity(
        _stored(returns), book.flows, float(book.nav[-1]), history_reaches_inception=False
    )
    assert ke.degrade_reasons == frozenset()
    for i, day in enumerate(book.days):
        assert _close(float(ke.equity[day]), book.nav[i]), day
