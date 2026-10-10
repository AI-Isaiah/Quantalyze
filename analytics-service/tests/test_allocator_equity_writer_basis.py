"""DERIBITWEDGE 167.1.2.2.1 D-06, the writer half: the Deribit key-mode derive stores the
flows and the day P&L its own NAV obeys.

Founder D-06 (2026-10-10): the +1.3% ``inception_unreconciled`` residual sits in the
compose-versus-writer gap. The allocator compose rolls backward through the event-time
``usd_signed`` flows and the stored returns, while the writer's NAV is built from native
quantities at day marks. So the writer stores, as stored inputs under D-03, the two series
its NAV obeys: ``composed_flows`` (native flow quantity x the day mark, one row per day with
a non-zero flow) and ``composed_day_pnl`` (``NAV_t - NAV_{t-1} - F_t``, day 0 against the
prior capital, one row per NAV day). Plan 11 makes the compose read them.

The oracle is an exact ``Fraction`` forward build of the same account (marks moving every
day, coin deposits whose event-time USD value deliberately differs from quantity x mark), so
the identity the stored fields must obey is checked against numbers the code never produced.
"""

from __future__ import annotations

import math
from fractions import Fraction

import pandas as pd
import pytest

from services.allocator_equity_derive import read_writer_basis
from services.broker_dailies import (
    combine_native_ledger,
    native_ledger_composed_flows,
    native_ledger_day_pnl,
    native_ledger_realized_terminal,
)
from services.external_flows import ExternalFlow
from services.native_nav import NativeLedger
from tests.test_allocator_equity_dropped_day_pnl import _iso, _key_inputs_payload
from tests.test_allocator_equity_realized_basis import _btc_book

_REL = 1e-12
_ABS = 1e-9


def _close(got: float, want: Fraction) -> bool:
    return math.isclose(got, float(want), rel_tol=_REL, abs_tol=_ABS)


def _book_ledger() -> tuple[NativeLedger, list[Fraction], list[Fraction], list[Fraction]]:
    """The ``_btc_book`` account as a ledger, plus its exact flows-in-USD, navs and marks.

    Each deposit's event-time ``usd_signed`` is quantity x mark x 1.013, so the event-time
    ``flows`` field and the writer's composed flows cannot be the same numbers."""
    q_pnl, q_flow, marks, bal, nav = _btc_book()
    n = len(q_pnl)
    idx = pd.DatetimeIndex([pd.Timestamp(_iso(i)) for i in range(n)])
    ledger = NativeLedger(
        native_pnl={"BTC": pd.Series([float(x) for x in q_pnl], index=idx)},
        terminal_native_equity={"BTC": float(bal[-1])},
        marks={"BTC": pd.Series([float(m) for m in marks], index=idx)},
        native_flows=[
            ExternalFlow(
                _iso(i),
                float(q_flow[i] * marks[i] * Fraction(1013, 1000)),
                "BTC",
                float(q_flow[i]),
            )
            for i in range(n)
            if q_flow[i] != 0
        ],
        terminal_upnl_native={},
        full_history=True,
    )
    flow_usd = [q_flow[i] * marks[i] for i in range(n)]
    return ledger, flow_usd, nav, marks


async def _run_derive(ledger: NativeLedger, *, extra_patches: list | None = None) -> dict:
    """The Deribit key-mode derive with the REAL combine / day-P&L / terminal / composed-flows
    functions (the helpers' stubs for them are overridden), returning the key_inputs payload."""
    import dataclasses
    from unittest.mock import AsyncMock, MagicMock, patch

    from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
    from tests.test_mtm_single_key import _apply, _base_patches, _ctx, _ledger_meta, _report

    returns, _ = combine_native_ledger(ledger, frozenset({"BTC"}))
    # the event-time flows the derive stores in ``flows`` come off the report, not the ledger
    report = dataclasses.replace(
        _report(has_option_activity=False), dated_external_flows=list(ledger.native_flows)
    )
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    patches = _base_patches(
        ctx,
        key_mode=True,
        ledger_mock=AsyncMock(return_value=(ledger, report)),
        combine_mock=MagicMock(return_value=(returns, _ledger_meta())),
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
    ] + (extra_patches or [])
    with _apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j-drb-basis", "kind": "derive_broker_dailies", "api_key_id": "key-drb"}
        )
    assert result.outcome == DispatchOutcome.DONE
    return _key_inputs_payload(capture, "key-drb")


# ── Task 1: the tracer ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_deribit_derive_stores_its_composed_flows_and_day_pnl() -> None:
    """D-06: the payload carries the flows and the day P&L the writer's NAV obeys, closing
    the writer's own identity against an independent exact oracle."""
    ledger, flow_usd, nav, _marks = _book_ledger()
    n = len(nav)
    payload = await _run_derive(ledger)

    # composed flows: quantity x the DAY MARK on each deposit day, and no other day
    stored_flows = {r["utc_day_iso"]: r["flow_usd"] for r in payload["composed_flows"]}
    want_flow_days = [_iso(i) for i in range(n) if flow_usd[i] != 0]
    assert sorted(stored_flows) == want_flow_days
    assert len(want_flow_days) == 2  # a deposit on a later day too, not only the funding day
    for i in range(n):
        if flow_usd[i] != 0:
            assert _close(stored_flows[_iso(i)], flow_usd[i])

    # composed day P&L: NAV_t - NAV_{t-1} - F_t, day 0 against a zero prior capital
    stored_pnl = {r["utc_day_iso"]: r["pnl_usd"] for r in payload["composed_day_pnl"]}
    assert sorted(stored_pnl) == [_iso(i) for i in range(n)]
    prev = Fraction(0)
    for i in range(n):
        want = nav[i] - prev - flow_usd[i]
        assert _close(stored_pnl[_iso(i)], want), (i, stored_pnl[_iso(i)], float(want))
        prev = nav[i]

    # the writer's identity, independent of the code: terminal = prev0 + sum(pnl) + sum(flows)
    terminal = payload["realized_terminal_usd"]
    assert _close(terminal, nav[-1])
    assert math.isclose(
        terminal,
        math.fsum(stored_pnl.values()) + math.fsum(stored_flows.values()),
        rel_tol=_REL,
        abs_tol=_ABS,
    )

    # the event-time flows field is untouched: still the usd_signed values
    event = {r["utc_day_iso"]: r["usd_signed"] for r in payload["flows"]}
    assert sorted(event) == want_flow_days
    for i in range(n):
        if flow_usd[i] != 0:
            assert math.isclose(event[_iso(i)], float(flow_usd[i] * Fraction(1013, 1000)), rel_tol=_REL)
            assert not math.isclose(event[_iso(i)], stored_flows[_iso(i)], rel_tol=1e-6)

    # the reader hands back the same two day-keyed maps
    basis = read_writer_basis(payload)
    assert basis is not None
    assert basis == (stored_flows, stored_pnl)


# ── Task 2: the stored fields are refused, read and pinned honestly ──────────


def _series(values: list[float], start: int = 0) -> pd.Series:
    return pd.Series(
        values, index=pd.DatetimeIndex([pd.Timestamp(_iso(start + i)) for i in range(len(values))])
    )


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")], ids=["nan", "inf", "-inf"])
@pytest.mark.parametrize("which", ["pnl", "flows"])
def test_a_non_finite_value_is_refused_before_the_upsert_without_naming_an_amount(
    which: str, bad: float
) -> None:
    from services.allocator_equity_derive import writer_basis_payload
    from services.nav_twr import NavReconstructionError

    pnl = _series([1.0, 2.0, 3.0])
    flows = _series([0.0, 5.0, 0.0])
    if which == "pnl":
        pnl = _series([1.0, bad, 3.0])
    else:
        flows = _series([0.0, bad, 0.0])
    with pytest.raises(NavReconstructionError, match="refusing to persist it") as exc:
        writer_basis_payload(pnl, flows)
    assert "nan" not in str(exc.value).lower() and "inf" not in str(exc.value).lower()
    assert not any(ch.isdigit() for ch in str(exc.value))  # counts-only: no amount, no day


def test_the_payload_keeps_every_nav_day_of_pnl_and_only_the_nonzero_flow_days() -> None:
    from services.allocator_equity_derive import writer_basis_payload

    payload = writer_basis_payload(_series([0.0, -2.5, 3.0]), _series([7.0, 0.0, 0.0]))
    assert payload == {
        "composed_flows": [{"utc_day_iso": _iso(0), "flow_usd": 7.0}],
        "composed_day_pnl": [
            {"utc_day_iso": _iso(0), "pnl_usd": 0.0},
            {"utc_day_iso": _iso(1), "pnl_usd": -2.5},
            {"utc_day_iso": _iso(2), "pnl_usd": 3.0},
        ],
    }
    assert read_writer_basis(payload) == (
        {_iso(0): 7.0},
        {_iso(0): 0.0, _iso(1): -2.5, _iso(2): 3.0},
    )


def _good() -> dict:
    return {
        "composed_flows": [{"utc_day_iso": "2026-02-01", "flow_usd": 5.0}],
        "composed_day_pnl": [
            {"utc_day_iso": "2026-02-01", "pnl_usd": 1.0},
            {"utc_day_iso": "2026-02-02", "pnl_usd": 2.0},
        ],
    }


@pytest.mark.parametrize("payload", [{}, {"composed_flows": None, "composed_day_pnl": None}],
                         ids=["absent", "null"])
def test_an_older_row_reads_as_none(payload: dict) -> None:
    assert read_writer_basis(payload) is None


@pytest.mark.parametrize("missing", ["composed_flows", "composed_day_pnl"])
@pytest.mark.parametrize("how", ["absent", "null"])
def test_one_field_without_the_other_is_a_corrupt_input_not_a_guess(missing: str, how: str) -> None:
    payload = _good()
    if how == "absent":
        del payload[missing]
    else:
        payload[missing] = None
    with pytest.raises(ValueError, match="must come together"):
        read_writer_basis(payload)


def _with(field: str, rows: object) -> dict:
    payload = _good()
    payload[field] = rows
    return payload


@pytest.mark.parametrize(
    ("payload", "match"),
    [
        (_with("composed_flows", [{"utc_day_iso": "2026-02-01", "flow_usd": 1.0},
                                  {"utc_day_iso": "2026-02-01", "flow_usd": 2.0}]), "duplicate day"),
        (_with("composed_day_pnl", [{"utc_day_iso": "2026-02-01", "pnl_usd": 1.0},
                                    {"utc_day_iso": "2026-02-01", "pnl_usd": 2.0}]), "duplicate day"),
        (_with("composed_day_pnl", [{"utc_day_iso": "not-a-day", "pnl_usd": 1.0}]), "Invalid isoformat"),
        (_with("composed_flows", [{"utc_day_iso": "2026-02-01", "flow_usd": "5.0"}]), "non-numeric"),
        (_with("composed_day_pnl", [{"utc_day_iso": "2026-02-01", "pnl_usd": True}]), "non-numeric"),
        (_with("composed_day_pnl", [{"utc_day_iso": "2026-02-01", "pnl_usd": float("nan")}]), "non-finite"),
        (_with("composed_flows", [{"utc_day_iso": "2026-02-01", "flow_usd": float("inf")}]), "non-finite"),
        (_with("composed_flows", [{"utc_day_iso": "2026-02-01"}]), "malformed row"),
        (_with("composed_day_pnl", {"2026-02-01": 1.0}), "not a list"),
    ],
    ids=["dup-flow", "dup-pnl", "bad-day", "str-amount", "bool-amount", "nan", "inf", "no-amount", "not-a-list"],
)
def test_a_malformed_stored_field_raises_rather_than_being_read_as_a_guess(
    payload: dict, match: str
) -> None:
    with pytest.raises(ValueError, match=match):
        read_writer_basis(payload)


@pytest.mark.asyncio
async def test_a_derive_without_a_terminal_or_day_pnl_stores_neither_field() -> None:
    """The gate: the fields travel with ``realized_terminal_*`` (the compose rolls from that
    terminal), so a derive that stored none of those stores none of these either."""
    from unittest.mock import MagicMock, patch

    ledger, *_ = _book_ledger()
    payload = await _run_derive(
        ledger,
        extra_patches=[
            patch(
                "services.broker_dailies.native_ledger_realized_terminal",
                new=MagicMock(return_value=None),
            )
        ],
    )
    assert "realized_terminal_usd" not in payload
    assert "composed_flows" not in payload and "composed_day_pnl" not in payload

    payload = await _run_derive(
        ledger,
        extra_patches=[
            patch(
                "services.broker_dailies.native_ledger_day_pnl",
                new=MagicMock(return_value=pd.Series(dtype="float64")),
            )
        ],
    )
    assert "composed_flows" not in payload and "composed_day_pnl" not in payload


@pytest.mark.asyncio
async def test_an_mt5_key_mode_derive_stores_neither_field(monkeypatch) -> None:
    """MT5 computes a day P&L and a terminal, but no composed flows: its payload keeps its keys."""
    import services.mt5_concurrency as mt5_conc
    from unittest.mock import AsyncMock, patch

    from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
    from tests.test_allocator_equity_dropped_day_pnl import _mt5_deals, funding_and_dominated_book
    from tests.test_mt5_derive_branch import (
        _apply,
        _build_ctx as _mt5_build_ctx,
        _FakeMt5Transport,
    )

    monkeypatch.setenv("MT5_ENABLED", "true")
    book = funding_and_dominated_book()
    nav_t = float(book.nav[-1])
    transport = _FakeMt5Transport(
        account={"equity": nav_t, "balance": nav_t, "currency": "USD", "login": 123456},
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
                {"id": "j-mt5-basis", "kind": "derive_broker_dailies", "api_key_id": "key-mt5"}
            )
    finally:
        mt5_conc.reset_terminal_state_for_tests()
    assert result.outcome == DispatchOutcome.DONE
    payload = _key_inputs_payload(capture, "key-mt5")
    assert "realized_terminal_usd" in payload and "dropped_day_pnl" in payload  # the MT5 basis it has
    assert "composed_flows" not in payload and "composed_day_pnl" not in payload


@pytest.mark.asyncio
async def test_a_ccxt_key_mode_derive_stores_neither_field() -> None:
    from tests.test_allocator_equity_realized_basis import _ordinary_book, _run_ccxt_key_mode

    book = _ordinary_book()
    nav_t = book.nav[-1]
    equity = float(nav_t + nav_t / 100)
    result, capture = await _run_ccxt_key_mode(
        book, venue="okx", equity=equity, upnl=float(nav_t / 100)
    )
    assert result.outcome.name == "DONE"
    payload = _key_inputs_payload(capture, "key-ccxt")
    assert "realized_terminal_usd" in payload  # the ccxt venue does store a terminal ...
    assert "composed_flows" not in payload and "composed_day_pnl" not in payload  # ... and no basis


@pytest.mark.asyncio
async def test_two_derives_over_the_same_stored_inputs_store_byte_equal_composed_fields(
    monkeypatch,
) -> None:
    """D-03: the second derive is built from the first's STORED ``account_summary`` against an
    exchange whose live state has since drifted; the stored composed fields are byte-equal."""
    import json

    from services import deribit_ingest as di
    from services.allocator_equity_derive import account_summary_payload, read_account_summary
    from services.broker_dailies import combine_native_ledger  # noqa: F401  (same path as the derive)
    from tests.test_deribit_ingest import _NativeAnchorStub, _patch_jul_index, _patch_pipeline
    from tests.test_derive_determinism import _A, _PERTURBATIONS, _rows_paginate

    from services.allocator_equity_derive import writer_basis_payload

    _patch_pipeline(
        monkeypatch, scopes=[di.Scope("main", None, True)],
        currencies={"main": ["BTC"]}, paginate=_rows_paginate(),
    )
    _patch_jul_index(monkeypatch)
    accrued = {**_A, "session_rpl": 0.03, "futures_session_rpl": 0.03,
               "equity": 9.01 + 0.1 + 1.20 + 0.03}
    live = _NativeAnchorStub(summaries=[accrued], index_price={"BTC": 60000.0})
    state = await di.fetch_deribit_native_account_state(live)
    ledger, report = await di.build_deribit_native_ledger(live, account_state=state)
    indexable = report.indexable_currencies
    first = writer_basis_payload(
        native_ledger_day_pnl(ledger, indexable), native_ledger_composed_flows(ledger, indexable)
    )

    stored = read_account_summary(json.loads(json.dumps(account_summary_payload(state))))
    assert stored is not None
    rebuilt = di.DeribitNativeAccountState.from_stored(stored)
    drifted, _ = _PERTURBATIONS["A"]
    after = _NativeAnchorStub(summaries=[drifted], index_price={"BTC": 61000.0})
    ledger2, report2 = await di.build_deribit_native_ledger(after, account_state=rebuilt)
    second = writer_basis_payload(
        native_ledger_day_pnl(ledger2, report2.indexable_currencies),
        native_ledger_composed_flows(ledger2, report2.indexable_currencies),
    )

    assert len(first["composed_day_pnl"]) >= 3 and first["composed_flows"]  # not trivially empty
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert after.summaries_calls == 0


# ═══ Plan 11, the compose half: the compose rolls on the writer's stored basis (D-06) ═══
#
# THE MEASURED SHAPE (plan 06 Task 1, H-D). From ONE key_inputs row per key, on PROD: the
# compose's implied start was 0.01311 of the first-return-day level, the writer's own prev0
# ratio was -8.5e-9. The compose rebuilds the writer's NAV from other numbers (event-time USD
# flows, stored returns, dropped days), so the gap accumulates over the history. The fixture
# reproduces that: the first deposit's event-time ``usd_signed`` is short of the writer's
# quantity x mark by 1.3% of the first-return-day level, so today's compose reads an implied
# start of that size, while the oracle account (a zero-start BTC book built forward in exact
# arithmetic) has a prev0 of exactly 0.

_MEASURED_C = Fraction(13, 1000)
_TRUST_REL = 1e-9
_ACCOUNT_LO, _ACCOUNT_HI = 0.012, 0.014


class _Measured:
    """The measured-shape account: ledger, the stored derive payload and the exact oracle."""

    def __init__(self) -> None:
        q_pnl, q_flow, marks, bal, nav = _btc_book()
        self.q_pnl, self.q_flow, self.marks, self.nav = q_pnl, q_flow, marks, nav
        n = len(q_pnl)
        self.n = n
        self.flow_usd = [q_flow[i] * marks[i] for i in range(n)]
        event = {i: self.flow_usd[i] for i in range(n) if q_flow[i] != 0}
        # the first deposit's event-time value falls short of quantity x mark by c x the level
        # on the first return day (day 1); the second deposit's event value is exact
        event[0] = self.flow_usd[0] - _MEASURED_C * nav[1]
        idx = pd.DatetimeIndex([pd.Timestamp(_iso(i)) for i in range(n)])
        self.ledger = NativeLedger(
            native_pnl={"BTC": pd.Series([float(x) for x in q_pnl], index=idx)},
            terminal_native_equity={"BTC": float(bal[-1])},
            marks={"BTC": pd.Series([float(m) for m in marks], index=idx)},
            native_flows=[
                ExternalFlow(_iso(i), float(event[i]), "BTC", float(q_flow[i]))
                for i in range(n)
                if q_flow[i] != 0
            ],
            terminal_upnl_native={},
            full_history=True,
        )
        self.returns, _ = combine_native_ledger(self.ledger, frozenset({"BTC"}))
        stored = self.returns.dropna()
        self.stored_returns = pd.Series(
            [float(v) for v in stored], index=[pd.Timestamp(d).date().isoformat() for d in stored.index]
        )

    def prev0(self) -> Fraction:
        """The writer's capital before day 0, from the independent oracle: day 0's P&L is the
        day's native P&L x its mark (the prior balance is zero), so nav0 - flow0 - pnl0."""
        return self.nav[0] - self.flow_usd[0] - self.q_pnl[0] * self.marks[0]


@pytest.fixture(scope="module")
def measured() -> _Measured:
    return _Measured()


@pytest.fixture(scope="module")
def measured_payload(measured: _Measured) -> dict:
    import asyncio

    return asyncio.run(_run_derive(measured.ledger))


def _legacy_inputs(payload: dict, returns: pd.Series):
    from services.allocator_equity_derive import read_dropped_day_pnl, read_realized_terminal
    from services.external_flows import validate_flow_shape

    flows = [
        validate_flow_shape(ExternalFlow(utc_day_iso=f["utc_day_iso"], usd_signed=float(f["usd_signed"])))
        for f in payload["flows"]
    ]
    return dict(
        returns=returns,
        flows=flows,
        anchor=float(payload["anchor_usd"]),
        history_reaches_inception=True,
        dropped_day_pnl=read_dropped_day_pnl(payload),
        realized_terminal=read_realized_terminal(payload),
    )


def _legacy_start_ratio(args: dict) -> float:
    """Today's compose start: the capital the legacy replay implies before the first flow, as
    a fraction of the level on the first return day (the quantity the inception check bounds)."""
    from services.allocator_equity_derive import _flows_by_day

    ke = args_replay(args)
    assert ke.equity is not None
    fbd = _flows_by_day(args["flows"])
    first_open = min(fbd)
    implied = (
        float(ke.equity.loc[first_open]) - fbd[first_open]
        - args["dropped_day_pnl"].get(first_open, 0.0)
    )
    return implied / float(ke.equity.loc[min(str(d) for d in args["returns"].index)])


def args_replay(args: dict):
    from services.allocator_equity_derive import replay_key_equity

    return replay_key_equity(
        args["returns"], args["flows"], args["anchor"],
        history_reaches_inception=args["history_reaches_inception"],
        dropped_day_pnl=args["dropped_day_pnl"],
        realized_terminal=args["realized_terminal"],
    )


def _guard_single(m: _Measured, payload: dict) -> float:
    """Fixture guard: today's compose reads the measured start, the writer's prev0 is zero."""
    assert m.prev0() == 0
    ratio = _legacy_start_ratio(_legacy_inputs(payload, m.stored_returns))
    assert _ACCOUNT_LO <= ratio <= _ACCOUNT_HI, ratio
    return ratio


_ALLOC = "alloc-basis"


async def _run_compose(
    members: list[dict], *, job_extra: dict | None = None, spy: dict | None = None
):
    """Run the compose job over stored rows exactly as given: ``(result, fake)``.

    Each member: ``id``, ``payload`` (the key_inputs payload as stored), ``returns`` (the stored
    return series), plus optional ``api_key`` overrides (exchange, sync status, share markers)."""
    from unittest.mock import patch

    from services.allocator_equity_compose import build_allocator_ledger
    from services.job_worker import run_derive_allocator_equity_job
    from tests.test_derive_allocator_equity_job import (
        DERIVED_TABLE,
        LEGACY_TABLE,
        _FakeSupabase,
        _gate_key,
    )

    fake = _FakeSupabase({
        "api_keys": [
            _gate_key(m["id"], _ALLOC, **{"exchange": "deribit", **m.get("api_key", {})})
            for m in members
        ],
        "csv_daily_returns": [
            {"api_key_id": m["id"], "allocator_id": _ALLOC, "date": str(d), "daily_return": float(v)}
            for m in members
            for d, v in m["returns"].items()
        ],
        DERIVED_TABLE: [
            {"allocator_id": _ALLOC, "kind": f"key_inputs:{m['id']}", "payload": m["payload"]}
            for m in members
        ],
        LEGACY_TABLE: [],
    })

    def _wrapped(ledger_flows, *a, **k):
        if spy is not None:
            spy["ledger_flows"] = {key: list(v) for key, v in ledger_flows.items()}
        return build_allocator_ledger(ledger_flows, *a, **k)

    with patch("services.job_worker.get_supabase", return_value=fake), patch(
        "services.allocator_equity_compose.build_allocator_ledger", side_effect=_wrapped
    ):
        result = await run_derive_allocator_equity_job(
            {"id": "j-basis", "kind": "derive_allocator_equity", "allocator_id": _ALLOC, **(job_extra or {})}
        )
    return result, fake


async def _compose_job(
    members: list[dict], *, job_extra: dict | None = None, spy: dict | None = None
) -> dict:
    """The equity_curve payload the compose job upserts (the job must end DONE)."""
    from tests.test_derive_allocator_equity_job import _curve_upserts, _extract_payload

    result, fake = await _run_compose(members, job_extra=job_extra, spy=spy)
    if result.outcome.name != "DONE":
        raise AssertionError((result.outcome, result.error_message))
    upserts = _curve_upserts(fake)
    assert len(upserts) == 1, fake.upserts
    return _extract_payload(upserts[0][1])


def _stored_row(payload: dict, *, live_over_terminal: float = 1.001, drop_fields: bool = False) -> dict:
    """The key_inputs payload as a compose job reads it: the live equity a hair above the
    writer's realized terminal (an open position), the as-of stamped to the terminal day."""
    out = {k: v for k, v in payload.items() if not (drop_fields and k in ("composed_flows", "composed_day_pnl"))}
    out["anchor_usd"] = float(payload["realized_terminal_usd"]) * live_over_terminal
    out["anchor_asof"] = f"{payload['realized_terminal_day']}T06:00:00+00:00"
    return out


def _curve_of(payload: dict) -> dict[str, float]:
    return {row["date"]: row["equity_usd"] for row in payload["curve"]}


def _assert_curve_is_the_oracle(payload: dict, nav: list[Fraction], upto: int) -> None:
    curve = _curve_of(payload)
    for i in range(upto):
        got, want = curve[_iso(i)], float(nav[i])
        assert math.isclose(got, want, rel_tol=_TRUST_REL), (i, got, want)


# ── Task 1: the compose's start is the writer's prev0 on the measured shape ───


@pytest.mark.asyncio
async def test_the_compose_start_matches_the_writers_prev0_on_the_measured_shape(
    measured: _Measured, measured_payload: dict
) -> None:
    ratio = _guard_single(measured, measured_payload)  # the fixture guard, before anything else
    assert ratio > 0.0

    spy: dict = {}
    payload = await _compose_job(
        [{"id": "key-drb", "payload": _stored_row(measured_payload), "returns": measured.stored_returns}],
        spy=spy,
    )

    assert payload["degrade_reasons"] == []
    assert payload["is_trustworthy"] is True
    assert "writer_basis" in payload["flags"]
    _assert_curve_is_the_oracle(payload, measured.nav, measured.n - 1)

    # the flags of the key itself: the opening run reconciles, it is not unreconciled
    args = _legacy_inputs(measured_payload, measured.stored_returns)
    stored = read_writer_basis(measured_payload)
    assert stored is not None
    from services.allocator_equity_derive import replay_key_equity

    ke = replay_key_equity(
        args["returns"], args["flows"], args["anchor"],
        history_reaches_inception=True,
        dropped_day_pnl=args["dropped_day_pnl"],
        realized_terminal=args["realized_terminal"],
        writer_flows=[ExternalFlow(d, a) for d, a in sorted(stored[0].items())],
        writer_day_pnl=stored[1],
    )
    assert "opening_flows_reconciled" in ke.flags
    assert "inception_unreconciled_flows" not in ke.flags
    assert ke.flags["writer_basis"] is True

    # the compose's flows for the key ARE the writer's composed flows (curve, ledger, MWR)
    got_flows = {str(f[0]): float(f[1]) for f in spy["ledger_flows"]["key-drb"]}
    assert got_flows == stored[0]
    assert got_flows != {f["utc_day_iso"]: f["usd_signed"] for f in measured_payload["flows"]}


@pytest.mark.asyncio
async def test_the_same_row_without_the_fields_composes_as_before(
    measured: _Measured, measured_payload: dict
) -> None:
    _guard_single(measured, measured_payload)
    spy: dict = {}
    payload = await _compose_job(
        [{
            "id": "key-drb",
            "payload": _stored_row(measured_payload, drop_fields=True),
            "returns": measured.stored_returns,
        }],
        spy=spy,
    )

    assert payload["degrade_reasons"] == ["inception_unreconciled"]
    assert payload["is_trustworthy"] is False
    assert "writer_basis" not in payload["flags"]
    # today's levels: the event-time roll (right on every day after the first deposit, whose
    # shortfall shows up in the start and nowhere else)
    _assert_curve_is_the_oracle(payload, measured.nav, measured.n - 1)
    event = {f["utc_day_iso"]: f["usd_signed"] for f in measured_payload["flows"]}
    assert {str(f[0]): float(f[1]) for f in spy["ledger_flows"]["key-drb"]} == event


class _Forward:
    """A small account built FORWARD in exact arithmetic, as the writer would store it.

    Day 0 is the funding day (a deposit of 1000, P&L 7). A day in ``skipped`` is a writer NAV day
    the stored returns leave out (it moves the NAV by +13 and has no return row, no flow). A day
    in ``gap`` is a day the writer has no NAV for at all: the returns carry a gap-fill row of
    exactly 0.0 there and the level is carried. Every other day has a return row and is in W.
    ``event_flows`` differ from the writer's flows by a hair, so the two roll paths cannot
    coincide by accident."""

    n = 10
    rets = {1: Fraction(1, 100), 2: Fraction(-1, 50), 3: Fraction(3, 100), 4: Fraction(-1, 200),
            5: Fraction(1, 200), 6: Fraction(-1, 100), 7: Fraction(2, 100), 8: Fraction(1, 100),
            9: Fraction(-3, 200)}
    flow = {0: Fraction(1000), 6: Fraction(250)}

    def __init__(self, *, skipped: frozenset[int] = frozenset(), gap: frozenset[int] = frozenset(),
                 drop_from_w: frozenset[int] = frozenset()) -> None:
        self.pnl: dict[int, Fraction] = {0: Fraction(7)}
        self.level: list[Fraction] = [Fraction(1007)]
        for t in range(1, self.n):
            if t in gap:
                self.pnl[t] = Fraction(0)
            elif t in skipped:
                self.pnl[t] = Fraction(13)
            else:
                self.pnl[t] = self.level[t - 1] * self.rets[t]
            self.level.append(self.level[t - 1] + self.pnl[t] + self.flow.get(t, 0))
        ret_days = [t for t in range(1, self.n) if t not in skipped]
        self.returns = pd.Series(
            {_iso(t): (0.0 if t in gap else float(self.rets[t])) for t in ret_days}, name="k"
        )
        # ``drop_from_w`` removes a NAV day from W while its (non-zero) return stays
        self.w_pnl = {
            _iso(t): float(p) for t, p in self.pnl.items() if t not in gap and t not in drop_from_w
        }
        self.w_flows = [ExternalFlow(_iso(t), float(f)) for t, f in self.flow.items()]
        self.event_flows = [ExternalFlow(_iso(t), float(f) * 1.01) for t, f in self.flow.items()]
        self.anchor = float(self.level[-1])
        self.terminal = (_iso(self.n - 1), float(self.level[-1]))

    def replay(self, *, terminal="default", basis=True, **kw):
        from services.allocator_equity_derive import replay_key_equity

        extra = (
            dict(writer_flows=self.w_flows, writer_day_pnl=self.w_pnl) if basis else {}
        )
        return replay_key_equity(
            self.returns, self.event_flows, self.anchor,
            history_reaches_inception=True,
            realized_terminal=self.terminal if terminal == "default" else terminal,
            **extra, **kw,
        )


def test_every_writer_pnl_day_is_replayed() -> None:
    """A writer NAV day the stored returns skip (no return row, no flow, no dropped-day P&L)
    still moves every earlier level. Without it in the replayed days the roll steps over it."""
    acct = _Forward(skipped=frozenset({4}))
    assert acct.pnl[4] != 0 and _iso(4) not in set(acct.returns.index) and 4 not in acct.flow  # guard

    ke = acct.replay()

    assert ke.flags.get("writer_basis") is True
    assert ke.equity is not None
    assert list(ke.equity.index) == [_iso(t) for t in range(acct.n)]  # the skipped day IS replayed
    for t in range(acct.n):
        assert float(ke.equity.loc[_iso(t)]) == pytest.approx(float(acct.level[t]), rel=1e-12), t
    assert ke.degrade_reasons == frozenset()


# ── Task 1: a stitched shared account takes the writer basis at the account level ───

# Three keys read ONE account. The two earlier members are eligible but not working
# (sync_status "error"), the kept key is working and starts last: the account is stitched.
# Each member holds its own window of the account's NAV days; the later members' first-day
# P&L is against the account's NAV the day before (the stored rows are slices of the one
# account oracle, so every member agrees on the days they share).
_STITCH_WINDOWS = {"key-A": (0, 7), "key-B": (5, 12), "key-M": (10, 17)}


def _member_rows(m: _Measured, full: dict, *, strip: frozenset[str] = frozenset()) -> list[dict]:
    full_flows = {r["utc_day_iso"]: r["usd_signed"] for r in full["flows"]}
    c_flows = {r["utc_day_iso"]: r["flow_usd"] for r in full["composed_flows"]}
    c_pnl = {r["utc_day_iso"]: r["pnl_usd"] for r in full["composed_day_pnl"]}
    dropped = {r["utc_day_iso"]: r["pnl_usd"] for r in full["dropped_day_pnl"]}
    cum: list[float] = []
    level = 0.0
    for i in range(m.n):
        level += c_pnl[_iso(i)] + c_flows.get(_iso(i), 0.0)
        cum.append(level)

    rows = []
    for key, (lo, hi) in _STITCH_WINDOWS.items():
        days = [_iso(i) for i in range(lo, hi + 1)]
        in_win = set(days)
        ret = m.stored_returns[[d for d in m.stored_returns.index if str(d) in in_win and str(d) != days[0]]]
        # a member's first NAV day carries no return of its own: it is a dropped day with a P&L
        member_dropped = {d: p for d, p in dropped.items() if d in in_win}
        member_dropped[days[0]] = c_pnl[days[0]]
        row = {
            "flows": [{"utc_day_iso": d, "usd_signed": v} for d, v in full_flows.items() if d in in_win],
            "anchor_usd": cum[hi] * 1.001,
            "anchor_null_reason": None,
            "anchor_asof": f"{_iso(hi)}T06:00:00+00:00",
            "venue": "deribit",
            "dropped_day_pnl": [{"utc_day_iso": d, "pnl_usd": p} for d, p in sorted(member_dropped.items())],
            "realized_terminal_usd": cum[hi],
            "realized_terminal_day": _iso(hi),
        }
        if key not in strip:
            row["composed_flows"] = [
                {"utc_day_iso": d, "flow_usd": v} for d, v in c_flows.items() if d in in_win
            ]
            row["composed_day_pnl"] = [{"utc_day_iso": d, "pnl_usd": c_pnl[d]} for d in days]
        api_key = {"venue_account_id": "venue-shared", "sync_status": "error"}
        if key != "key-A":
            api_key = {
                "account_share_kind": "duplicate",
                "account_shared_with_api_key_id": "key-A",
                "sync_status": "connected" if key == "key-M" else "error",
            }
        rows.append({"id": key, "payload": row, "returns": ret, "api_key": api_key})
    return rows


def _guard_stitched(m: _Measured, rows: list[dict]) -> float:
    """Fixture guard: the account's legacy stitched replay starts at the measured ratio."""
    from services.allocator_equity_derive import (
        read_dropped_day_pnl,
        stitch_dropped_day_pnl,
        stitch_shared_account,
    )
    from services.external_flows import validate_flow_shape

    def _flows(p):
        return [validate_flow_shape(ExternalFlow(f["utc_day_iso"], float(f["usd_signed"]))) for f in p["flows"]]

    assert m.prev0() == 0
    links = [(r["returns"], _flows(r["payload"])) for r in rows]
    stitched = stitch_shared_account(links)
    assert stitched is not None
    returns, flows = stitched
    dropped = stitch_dropped_day_pnl([r["returns"] for r in rows], [read_dropped_day_pnl(r["payload"]) for r in rows])
    kept = rows[-1]["payload"]
    args = dict(
        returns=returns, flows=flows, anchor=float(kept["anchor_usd"]),
        history_reaches_inception=True, dropped_day_pnl=dropped,
        realized_terminal=(kept["realized_terminal_day"], float(kept["realized_terminal_usd"])),
    )
    ratio = _legacy_start_ratio(args)
    assert _ACCOUNT_LO <= ratio <= _ACCOUNT_HI, ratio
    return ratio


@pytest.mark.asyncio
async def test_a_stitched_account_on_the_measured_shape_composes_on_the_writer_basis(
    measured: _Measured, measured_payload: dict
) -> None:
    rows = _member_rows(measured, measured_payload)
    _guard_stitched(measured, rows)

    spy: dict = {}
    payload = await _compose_job(rows, spy=spy)

    assert payload["degrade_reasons"] == []
    assert payload["is_trustworthy"] is True
    assert "shared_account_history_stitched" in payload["flags"]
    assert "writer_basis" in payload["flags"]
    _assert_curve_is_the_oracle(payload, measured.nav, measured.n - 1)
    # the stitched account's flows are the writer's composed flows, one owner per day
    full = {r["utc_day_iso"]: r["flow_usd"] for r in measured_payload["composed_flows"]}
    assert {str(f[0]): float(f[1]) for f in spy["ledger_flows"]["key-M"]} == full


# sha256 of the equity_curve payload today's code produces from the fieldless rows (the
# ``composed_at`` stamp excluded), measured at the plan base before the compose changed.
_FIELDLESS_STITCHED_SHA256 = "f0b6dda4fcff5153eb1d2e359f3f2d238ff07337e3ac9ac610c241ff3dd3b304"


# SFH-02 (fix round 1): a stitched account that falls to today's roll because a member lacks a
# writer basis says so in the payload. These are the only payload fields the fieldless pin
# below ignores; the rest of the payload stays byte-equal to the recorded reference.
_ABSENT_TOKEN = "writer_basis_absent_stitched"
_PARTIAL_TOKEN = "writer_basis_partial_stitched"
_MISSING_COUNT = "writer_basis_missing_members"
_STITCHED_COUNT = "writer_basis_stitched_members"


def _stable(payload: dict) -> str:
    import json

    visibility = {_ABSENT_TOKEN, _PARTIAL_TOKEN}
    body = {k: v for k, v in payload.items() if k not in ("inputs", "flags")}
    body["flags"] = [t for t in payload["flags"] if t not in visibility]
    body["inputs"] = {
        k: v
        for k, v in payload["inputs"].items()
        if k not in ("composed_at", _MISSING_COUNT, _STITCHED_COUNT)
    }
    return json.dumps(body, sort_keys=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["all", "key-A", "key-B", "key-M"])
async def test_a_stitched_account_without_the_fields_composes_as_today(
    measured: _Measured, measured_payload: dict, missing: str
) -> None:
    """All members or none: one member without the fields leaves the whole account on today's
    path, byte for byte. The reference is the payload today's code produced from the fieldless
    rows (its sha256 was recorded at the plan base, before the code changed). Only the SFH-02
    visibility fields (two flag tokens, two input counts) are set aside before hashing; the
    next test pins them."""
    import hashlib

    strip = frozenset(_STITCH_WINDOWS) if missing == "all" else frozenset({missing})
    rows = _member_rows(measured, measured_payload, strip=strip)
    _guard_stitched(measured, rows)
    payload = await _compose_job(rows)

    assert payload["degrade_reasons"] == ["inception_unreconciled"]
    assert "writer_basis" not in payload["flags"]
    assert hashlib.sha256(_stable(payload).encode()).hexdigest() == _FIELDLESS_STITCHED_SHA256


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("missing", "n_missing", "partial"),
    [("all", 3, False), ("key-A", 1, True), ("key-B", 1, True), ("key-M", 1, True)],
)
async def test_a_stitched_account_on_the_legacy_roll_says_so_in_the_payload(
    measured: _Measured, measured_payload: dict, missing: str, n_missing: int, partial: bool
) -> None:
    """SFH-02: the legacy roll for a stitched account is by design, but it must be visible. A
    non-blocking flag token marks it and a count says how many members lacked a basis. A
    fully pre-deploy account (no member carries a basis) reads a missing count equal to the
    member count and no partial token; a partial one also carries the partial token, because
    that is the shape a half-deployed writer leaves."""
    strip = frozenset(_STITCH_WINDOWS) if missing == "all" else frozenset({missing})
    rows = _member_rows(measured, measured_payload, strip=strip)
    payload = await _compose_job(rows)

    assert _ABSENT_TOKEN in payload["flags"]
    assert (_PARTIAL_TOKEN in payload["flags"]) is partial
    assert payload["inputs"][_MISSING_COUNT] == n_missing
    assert payload["inputs"][_STITCHED_COUNT] == 3
    # never blocking: the visibility fields add no degrade reason of their own
    assert payload["degrade_reasons"] == ["inception_unreconciled"]


@pytest.mark.asyncio
async def test_a_stitched_account_on_the_writer_basis_carries_no_absence_marker(
    measured: _Measured, measured_payload: dict
) -> None:
    rows = _member_rows(measured, measured_payload)
    payload = await _compose_job(rows)

    assert "writer_basis" in payload["flags"]
    assert _ABSENT_TOKEN not in payload["flags"]
    assert _PARTIAL_TOKEN not in payload["flags"]
    assert _MISSING_COUNT not in payload["inputs"]
    assert _STITCHED_COUNT not in payload["inputs"]


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", ["binance", "okx", "mt5"])
@pytest.mark.parametrize("missing", ["all", "key-A"])
async def test_a_stitched_account_on_a_venue_that_writes_no_basis_carries_no_absence_marker(
    measured: _Measured, measured_payload: dict, venue: str, missing: str
) -> None:
    """R2-WR-03: only the Deribit NAV path writes a writer basis, so a stitched Binance, OKX or
    MT5 account has none on any member, ever. The legacy roll is its only roll, not a
    degradation, and flagging it would bury the one case SFH-02 exists to surface (a Deribit
    stitched account on the legacy roll). Neither token nor either count appears, whether no
    member or only some carry the fields."""
    strip = frozenset(_STITCH_WINDOWS) if missing == "all" else frozenset({missing})
    rows = _member_rows(measured, measured_payload, strip=strip)
    for r in rows:
        r["api_key"] = {**r["api_key"], "exchange": venue}
    payload = await _compose_job(rows)

    assert "shared_account_history_stitched" in payload["flags"]
    assert _ABSENT_TOKEN not in payload["flags"]
    assert _PARTIAL_TOKEN not in payload["flags"]
    assert _MISSING_COUNT not in payload["inputs"]
    assert _STITCHED_COUNT not in payload["inputs"]


def test_the_writer_basis_venue_set_is_the_one_the_writer_gates_on() -> None:
    """R2-WR-03: one source of truth. The key_inputs writer and the compose-side visibility
    counts both read ``WRITER_BASIS_VENUES``; the Deribit NAV path is the only writer today."""
    from services.job_worker import WRITER_BASIS_VENUES

    assert WRITER_BASIS_VENUES == frozenset({"deribit"})


# ═══ Task 2: the writer-basis mode degrades honestly and keeps SC-3's hardening ═══


def test_one_writer_argument_without_the_other_is_a_value_error() -> None:
    from services.allocator_equity_derive import replay_key_equity

    acct = _Forward()
    with pytest.raises(ValueError, match="together or not at all"):
        replay_key_equity(acct.returns, acct.event_flows, acct.anchor, writer_day_pnl=acct.w_pnl)
    with pytest.raises(ValueError, match="together or not at all"):
        replay_key_equity(acct.returns, acct.event_flows, acct.anchor, writer_flows=acct.w_flows)


def test_an_empty_writer_day_pnl_is_the_legacy_replay_without_a_flag() -> None:
    acct = _Forward()
    ke = acct.replay(basis=False)
    from services.allocator_equity_derive import replay_key_equity

    empty = replay_key_equity(
        acct.returns, acct.event_flows, acct.anchor, history_reaches_inception=True,
        realized_terminal=acct.terminal, writer_day_pnl={}, writer_flows=[],
    )
    pd.testing.assert_series_equal(empty.equity, ke.equity, check_exact=True)
    assert empty.flags == ke.flags
    assert empty.degrade_reasons == ke.degrade_reasons


def test_a_return_on_a_day_outside_the_writers_calendar_is_a_mismatch_not_a_guess() -> None:
    from services.allocator_equity_derive import DegradeReason

    acct = _Forward(drop_from_w=frozenset({3}))  # day 3 keeps its non-zero return, loses its P&L
    assert float(acct.returns.loc[_iso(3)]) != 0.0 and _iso(3) not in acct.w_pnl  # fixture guard
    ke = acct.replay()

    assert ke.flags["writer_basis_mismatch"] is True
    assert "writer_basis" not in ke.flags
    assert DegradeReason.KEY_INPUTS_MISMATCH in ke.degrade_reasons
    assert ke.is_trustworthy is False


def test_the_mismatch_fallback_is_the_legacy_replay() -> None:
    """On a mismatch the levels are exactly the levels of the call without the writer arguments:
    event-time flows, the dropped-day map, the terminal."""
    acct = _Forward(drop_from_w=frozenset({3}))
    dropped = {_iso(0): 7.0}
    ke = acct.replay(dropped_day_pnl=dropped)
    legacy = acct.replay(basis=False, dropped_day_pnl=dropped)

    assert ke.flags["writer_basis_mismatch"] is True
    pd.testing.assert_series_equal(ke.equity, legacy.equity, check_exact=True)
    assert {k: v for k, v in ke.flags.items() if k != "writer_basis_mismatch"} == legacy.flags


@pytest.mark.parametrize("terminal", ["absent", "an earlier day", "a later day"])
def test_a_terminal_that_is_not_on_the_last_writer_day_is_a_mismatch(terminal: str) -> None:
    from services.allocator_equity_derive import DegradeReason

    acct = _Forward()
    tday, tusd = acct.terminal
    given = {
        "absent": None,
        "an earlier day": (_iso(acct.n - 2), tusd),
        "a later day": (_iso(acct.n), tusd),
    }[terminal]
    ke = acct.replay(terminal=given)

    assert ke.flags["writer_basis_mismatch"] is True
    assert "writer_basis" not in ke.flags
    assert DegradeReason.KEY_INPUTS_MISMATCH in ke.degrade_reasons


def test_a_writer_flow_off_the_writers_calendar_is_a_mismatch() -> None:
    acct = _Forward()
    acct.w_flows = acct.w_flows + [ExternalFlow(_iso(4), 5.0)]
    acct.w_pnl = {d: p for d, p in acct.w_pnl.items() if d != _iso(4)}
    ke = acct.replay()
    assert ke.flags["writer_basis_mismatch"] is True


def test_a_gap_fill_row_off_the_writers_calendar_carries_the_previous_writer_level() -> None:
    """The returns carry a stored 0.0 on a day the writer has no NAV for: not a mismatch, and
    the level on that day is the previous writer day's."""
    acct = _Forward(gap=frozenset({4}))
    assert float(acct.returns.loc[_iso(4)]) == 0.0 and _iso(4) not in acct.w_pnl  # fixture guard
    ke = acct.replay()

    assert "writer_basis_mismatch" not in ke.flags
    assert ke.flags["writer_basis"] is True
    assert ke.degrade_reasons == frozenset()
    assert ke.equity is not None
    for t in range(acct.n):
        assert float(ke.equity.loc[_iso(t)]) == pytest.approx(float(acct.level[t]), rel=1e-12), t
    assert float(ke.equity.loc[_iso(4)]) == float(ke.equity.loc[_iso(3)])


# ── the SC-3 hardening is not weakened (T-167.1.2.2.1-43) ────────────────────


def _collapse_basis(*, stored_return: bool):
    """``_loss_collapse`` as the writer would store it: its exact day P&L is in W, the collapse
    day included, while nothing ever stored it as a dropped day and no flow withdraws.
    ``stored_return=True`` keeps the -99.5% return row (the writer's own account of the day);
    ``False`` replaces it by a gap-fill 0.0 (a returns set from another derive than W), so
    nothing but W carries the fall."""
    from tests.test_allocator_equity_emptied_stretch import _N, _loss_collapse

    r, flows, _anchor, _final = _loss_collapse()
    level = Fraction(100)
    pnl = {_iso(0): 0.0}
    for t in range(1, _N):
        p = level * Fraction(float(r.loc[_iso(t)]))
        pnl[_iso(t)] = float(p)
        level += p
    if not stored_return:
        r = r.copy()
        r.loc[_iso(10)] = 0.0
    return r, flows, float(level), pnl


def test_a_collapse_only_the_writers_pnl_carries_still_refuses_on_the_writer_basis() -> None:
    """The SC-3 hardening, kept for what is genuinely unexplained: the fall sits in W alone (the
    returns carry a gap-fill 0.0 there, no flow withdraws, no dropped-day P&L is stored). W covers
    every NAV day, so reading it as an explanation would make the hardening vacuous."""
    from services.allocator_equity_derive import NavReconstructionError, replay_key_equity
    from tests.test_allocator_equity_emptied_stretch import _N

    r, flows, terminal, pnl = _collapse_basis(stored_return=False)
    assert pnl[_iso(10)] != 0.0  # W covers the collapse day: this is the vacuity trap
    with pytest.raises(NavReconstructionError) as exc:
        replay_key_equity(
            r, flows, terminal, history_reaches_inception=True,
            realized_terminal=(_iso(_N - 1), terminal),
            writer_flows=flows, writer_day_pnl=pnl,
        )
    msg = str(exc.value)
    assert "an emptied stretch begins on day 10 of 36" in msg
    assert "no withdrawal, no stored day P&L and no stored return" in msg
    # day indices and counts only: no level magnitude of the fixture
    for token in ("109", "100.0", f"{terminal:.4f}", f"{terminal:.2f}"):
        assert token not in msg


@pytest.mark.parametrize(
    "stored", [-0.001, -0.5, 0.02], ids=["small-loss", "loss-too-small-for-the-fall", "a-gain"]
)
def test_a_stored_return_that_does_not_account_for_the_fall_does_not_explain_it(stored: float) -> None:
    """D-09 (c), SFH-R2-F1. The fall (-99.5%) sits in W, and the returns carry a NON-ZERO row for
    the day that does not account for it: a small loss, a loss far short of the fall, or a gain.
    CR-01's clause was ``r != 0``, so any of these read the collapse as explained and a mis-dated
    flow that landed a level in the band passed as zero capital. A stored return explains the
    first day of a stretch only when it is a loss that accounts for the drop: the previous level
    times (1 + r) must reach this level."""
    from services.allocator_equity_derive import NavReconstructionError, replay_key_equity
    from tests.test_allocator_equity_emptied_stretch import _N

    r, flows, terminal, pnl = _collapse_basis(stored_return=False)
    r = r.copy()
    r.loc[_iso(10)] = stored
    assert pnl[_iso(10)] != 0.0 and r.loc[_iso(10)] != 0.0  # W covers it; the row is non-zero
    with pytest.raises(NavReconstructionError, match="an emptied stretch begins on day 10 of 36"):
        replay_key_equity(
            r, flows, terminal, history_reaches_inception=True,
            realized_terminal=(_iso(_N - 1), terminal),
            writer_flows=flows, writer_day_pnl=pnl,
        )


def test_a_loss_collapse_with_a_stored_return_composes_on_the_writer_basis() -> None:
    """CR-01 on the writer basis: the same fall, but the returns carry the writer's own -99.5%
    row for the day, which explains it (an ordinary trading loss), so it is zero capital."""
    from services.allocator_equity_derive import replay_key_equity
    from tests.test_allocator_equity_emptied_stretch import _N

    r, flows, terminal, pnl = _collapse_basis(stored_return=True)
    ke = replay_key_equity(
        r, flows, terminal, history_reaches_inception=True,
        realized_terminal=(_iso(_N - 1), terminal),
        writer_flows=flows, writer_day_pnl=pnl,
    )
    assert ke.flags["writer_basis"] is True
    assert ke.flags["emptied_stretches"] == 1
    assert ke.equity is not None
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(10, _N))
    assert ke.degrade_reasons == frozenset()


@pytest.mark.parametrize(
    "key_args",
    [
        {"stretch": Fraction(0)},
        {"stretch": Fraction(-1, 10**6)},
        {"stretch": Fraction(1, 10**6)},
        {"stretch": Fraction(0), "dust_day": 20, "dust": Fraction(1, 10**8)},
    ],
    ids=["zero", "minus-1e-6", "plus-1e-6", "dust-redeposit"],
)
def test_the_emptied_stretch_key_on_the_writer_basis_matches_the_legacy_replay(key_args: dict) -> None:
    """The ``Stretch`` key from the emptied-stretch file, with its exact writer P&L and flows as
    W: the same stretch counts as the legacy replay, every emptied day exactly 0.0."""
    from tests.test_allocator_equity_emptied_stretch import _N, Stretch

    key = Stretch(key_args["stretch"], **{k: v for k, v in key_args.items() if k != "stretch"})
    flows = key.flows
    fbd: dict[str, Fraction] = {}
    for f in flows:
        fbd[f.utc_day_iso] = fbd.get(f.utc_day_iso, Fraction(0)) + Fraction(f.usd_signed)
    prev = Fraction(0)
    w_pnl: dict[str, float] = {}
    for i in range(_N):
        w_pnl[_iso(i)] = float(key.level[i] - prev - fbd.get(_iso(i), Fraction(0)))
        prev = key.level[i]
    terminal = (_iso(_N - 1), key.anchor)

    legacy = key.replay(realized_terminal=terminal)
    ke = key.replay(realized_terminal=terminal, writer_flows=flows, writer_day_pnl=w_pnl)

    assert ke.flags["writer_basis"] is True
    for name in ("emptied_stretch_days", "emptied_stretches", "emptied_stretch"):
        assert ke.flags[name] == legacy.flags[name], name
    assert ke.equity is not None and legacy.equity is not None
    emptied = key.oracle_emptied()
    for i, is_empty in enumerate(emptied):
        if is_empty:
            assert float(ke.equity.loc[_iso(i)]) == 0.0, i
        else:
            assert float(ke.equity.loc[_iso(i)]) == pytest.approx(float(key.level[i]), rel=1e-9), i
    assert ke.degrade_reasons == legacy.degrade_reasons


# ── the compose job ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_mismatch_keeps_the_event_time_flows_in_the_ledger(
    measured: _Measured, measured_payload: dict
) -> None:
    """The returns come from another derive than the row (a return the writer's calendar does not
    hold): the key degrades, rolls the existing way, and its ledger flows stay event-time."""
    row = _stored_row(measured_payload)
    row["composed_day_pnl"] = [r for r in row["composed_day_pnl"] if r["utc_day_iso"] != _iso(5)]
    assert _iso(5) in set(measured.stored_returns.index)  # a non-zero return the row no longer holds
    spy: dict = {}
    payload = await _compose_job(
        [{"id": "key-drb", "payload": row, "returns": measured.stored_returns}], spy=spy
    )

    assert "key_inputs_mismatch" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "writer_basis" not in payload["flags"]
    event = {f["utc_day_iso"]: f["usd_signed"] for f in measured_payload["flows"]}
    assert {str(f[0]): float(f[1]) for f in spy["ledger_flows"]["key-drb"]} == event


@pytest.mark.asyncio
async def test_a_departed_key_whose_row_carries_the_fields_is_replayed_on_the_writer_basis() -> None:
    """A revoked key's history is replayed from its SAVED row. A row with the fields rolls on
    the writer's basis (its event-time flows are a hair off, so the legacy start would not
    reconcile); a row without them is the legacy replay."""
    acct = _Forward()
    last_live = 20
    live_days = [_iso(i) for i in range(0, last_live + 1)]
    live = {
        "id": "key-L",
        "payload": {
            "flows": [], "anchor_usd": 1000.0, "anchor_null_reason": None,
            "anchor_asof": f"{live_days[-1]}T06:00:00+00:00", "venue": "binance",
        },
        "returns": pd.Series([0.01] * len(live_days), index=live_days),
        "api_key": {"exchange": "binance"},
    }
    tday, tusd = acct.terminal

    def _departed(with_fields: bool) -> dict:
        payload = {
            "flows": [{"utc_day_iso": f.utc_day_iso, "usd_signed": f.usd_signed} for f in acct.event_flows],
            "anchor_usd": tusd, "anchor_null_reason": None,
            "anchor_asof": f"{tday}T06:00:00+00:00", "venue": "deribit",
            "realized_terminal_usd": tusd, "realized_terminal_day": tday,
        }
        if with_fields:
            payload["composed_flows"] = [
                {"utc_day_iso": f.utc_day_iso, "flow_usd": f.usd_signed} for f in acct.w_flows
            ]
            payload["composed_day_pnl"] = [
                {"utc_day_iso": d, "pnl_usd": p} for d, p in sorted(acct.w_pnl.items())
            ]
        return {
            "id": "key-D", "payload": payload, "returns": acct.returns,
            "api_key": {"sync_status": "revoked", "venue_account_id": "acct-departed"},
        }

    payload = await _compose_job([live, _departed(True)])
    # day 0 is only the departed key's (its funding day has no return), so the book reads the
    # benign coverage reasons; what it must NOT read is the inception verdict
    assert "inception_unreconciled" not in payload["degrade_reasons"]
    assert set(payload["degrade_reasons"]) <= {"classified_rotation", "window_truncated"}
    assert payload["is_trustworthy"] is True
    assert "departed_history_included" in payload["flags"]
    assert "writer_basis" in payload["flags"]
    curve = _curve_of(payload)
    for t in range(1, acct.n):
        live_level = 1000.0 / 1.01 ** (last_live - t)
        assert math.isclose(
            curve[_iso(t)], live_level + float(acct.level[t]), rel_tol=_TRUST_REL
        ), t

    legacy = await _compose_job([live, _departed(False)])
    assert "inception_unreconciled" in legacy["degrade_reasons"]
    assert legacy["is_trustworthy"] is False
    assert "writer_basis" not in legacy["flags"]


@pytest.mark.asyncio
@pytest.mark.parametrize("which", ["string amount", "a day twice", "pnl without flows"])
async def test_a_malformed_stored_basis_disposes_the_compose_job_as_a_corrupt_input(
    measured: _Measured, measured_payload: dict, which: str
) -> None:
    row = _stored_row(measured_payload)
    if which == "string amount":
        row["composed_day_pnl"] = [dict(r) for r in row["composed_day_pnl"]]
        row["composed_day_pnl"][3]["pnl_usd"] = "987654.32"
    elif which == "a day twice":
        row["composed_day_pnl"] = row["composed_day_pnl"] + [dict(row["composed_day_pnl"][0])]
    else:
        del row["composed_flows"]
    result, fake = await _run_compose(
        [{"id": "key-drb", "payload": row, "returns": measured.stored_returns}]
    )

    assert result.outcome.name == "FAILED"
    assert result.error_kind == "permanent"
    assert "corrupt persisted input" in result.error_message
    assert "987654" not in result.error_message  # the amount is redacted, never echoed
    from tests.test_derive_allocator_equity_job import _curve_upserts

    assert _curve_upserts(fake) == []


def test_the_writer_basis_adds_no_degrade_reason() -> None:
    from services.allocator_equity_derive import DegradeReason

    assert not any("WRITER" in m.name for m in DegradeReason)


def test_the_refusal_for_a_non_finite_writer_pnl_names_no_amount() -> None:
    from services.allocator_equity_derive import NavReconstructionError

    acct = _Forward()
    acct.w_pnl = {**acct.w_pnl, _iso(2): float("nan")}
    with pytest.raises(NavReconstructionError) as exc:
        acct.replay()
    msg = str(exc.value)
    assert "non-finite writer day P&L" in msg
    assert not any(ch.isdigit() for ch in msg)
