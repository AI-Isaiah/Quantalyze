"""Phase 167.1.2.2 D-13 / D-14 — opening flows are judged by a zero-start check.

A return series starts the day AFTER an account's first ledger event (the funding
day's return is undefined: its prior capital is zero). On a venue whose history
reaches the account's start the first flows therefore sit BEFORE the first return
day, and the old positional rule (``OUT_OF_WINDOW_FLOW``) fired on all 14 PROD keys
with flows, whatever their history looked like.

The rule now is the invariant the shape implies: the capital the replay says existed
BEFORE the first flow must be ~zero, within 1e-4 of the level on the window's first
return day (founder D-14, 2026-10-08). Inside the band the run is the normal opening
shape and does not block; outside it blocks as ``inception_unreconciled``.

THE ORACLE IS INDEPENDENT OF THE CODE UNDER TEST. Every fixture is built FORWARD in
exact rational arithmetic (``fractions.Fraction``) from a chosen pre-funding capital
``s``: ``level = s``, each opening flow is added on its own return-less day, the first
return day compounds, and so on. The terminal level is the anchor handed to the
replay. The expected verdict is ``|s| / level_on_first_return_day <= 1/10_000``
computed in exact arithmetic here, never read off the replay. Each fixture also
asserts its own share lands on the intended side of the band with margin, so a
fixture that drifted onto the line could not pass quietly.
"""
from __future__ import annotations

from datetime import date, timedelta
from fractions import Fraction

import pandas as pd
import pytest

from services import allocator_equity_derive as derive
from services.allocator_equity_compose import compose_allocator_equity
from services.allocator_equity_derive import (
    FULL_HISTORY_VENUES,
    DegradeReason,
    replay_key_equity,
)
from services.external_flows import ExternalFlow

# The founder's number (D-14), restated here on purpose: the test must not read the
# band from the module it checks.
BAND = Fraction(1, 10_000)

LO = date(2026, 3, 10)  # the window's first return day
_N_WINDOW = 30
_WINDOW_RETURNS = [0.011, -0.007, 0.013, 0.002, -0.004] * (_N_WINDOW // 5)


def _iso(offset_from_lo: int) -> str:
    return (LO + timedelta(days=offset_from_lo)).isoformat()


def _returns() -> pd.Series:
    return pd.Series(
        _WINDOW_RETURNS,
        index=[_iso(i) for i in range(_N_WINDOW)],
        name="k",
    )


def _exact_book(
    start_capital: Fraction,
    flows: dict[int, float],
    window_flows: dict[int, float] | None = None,
) -> tuple[Fraction, float]:
    """(exact level on the first return day, terminal anchor) built FORWARD in exact
    arithmetic. ``flows`` is {offset from LO: signed amount} for the days BEFORE LO
    (each a return-less day, r = 0); ``window_flows`` is the same for window days.
    A flow lands on its day's level after that day's return, mirroring the identity
    ``L_t = L_{t-1} * (1 + r_t) + F_t``."""
    window_flows = window_flows or {}
    level = Fraction(start_capital)
    for off in sorted(o for o in flows if o < 0):
        level = level + Fraction(flows[off])
    level_lo = Fraction(0)
    for i, r in enumerate(_WINDOW_RETURNS):
        level = level * (1 + Fraction(r)) + Fraction(window_flows.get(i, 0.0))
        if i == 0:
            level_lo = level
    return level_lo, float(level)


def _start_for_share(target_share: float, first_return_level_guess: float) -> Fraction:
    """A pre-funding capital whose share of the first-return-day level is ~target.
    Approximate by design: the fixture then measures its OWN exact share."""
    return Fraction(round(target_share * first_return_level_guess * 100), 100)


def _flows(spec: dict[int, float]) -> list[ExternalFlow]:
    return [ExternalFlow(_iso(off), amount) for off, amount in sorted(spec.items())]


def _share(start: Fraction, level_lo: Fraction) -> Fraction:
    return abs(start) / level_lo


# ── a clean opening deposit INSIDE the band is not blocked ────────────────────

@pytest.mark.parametrize("sign", [+1, -1], ids=["positive-residue", "negative-residue"])
def test_clean_opening_deposit_inside_band_does_not_block(sign: int) -> None:
    flows = {-1: 100_000.0}
    start = sign * _start_for_share(0.5e-4, 100_000.0)
    level_lo, anchor = _exact_book(start, flows)
    assert Fraction(1, 3) * BAND < _share(start, level_lo) < Fraction(7, 10) * BAND  # fixture guard

    ke = replay_key_equity(_returns(), _flows(flows), anchor, history_reaches_inception=True)

    assert ke.equity is not None
    assert ke.is_trustworthy is True
    assert ke.degrade_reasons == frozenset()
    assert ke.flags == {"opening_flows_reconciled": 1}
    # The levels are the exact forward construction, not merely "not blocked".
    assert float(ke.equity.loc[_iso(0)]) == pytest.approx(float(level_lo), rel=1e-9)


# ── one just OUTSIDE the band blocks, under the honest name ───────────────────

@pytest.mark.parametrize("sign", [+1, -1], ids=["positive-residue", "negative-residue"])
def test_opening_deposit_just_outside_band_is_inception_unreconciled(sign: int) -> None:
    flows = {-1: 100_000.0}
    start = sign * _start_for_share(1.4e-4, 100_000.0)
    level_lo, anchor = _exact_book(start, flows)
    assert Fraction(12, 10) * BAND < _share(start, level_lo) < Fraction(17, 10) * BAND  # fixture guard

    ke = replay_key_equity(_returns(), _flows(flows), anchor, history_reaches_inception=True)

    assert ke.equity is not None  # a suspect curve is still returned, flagged
    assert ke.is_trustworthy is False
    assert ke.degrade_reasons == frozenset({DegradeReason.INCEPTION_UNRECONCILED})
    assert DegradeReason.OUT_OF_WINDOW_FLOW not in ke.degrade_reasons
    assert ke.flags == {"inception_unreconciled_flows": 1}


def test_a_start_the_size_of_the_deposit_is_unreconciled_not_out_of_window() -> None:
    """The PROD shape that motivated D-13: the replay implies 55% of the window's
    first-day level existed before the first flow. Blocked, and named for that."""
    flows = {-1: 100_000.0}
    start = Fraction(120_000)
    level_lo, anchor = _exact_book(start, flows)
    assert _share(start, level_lo) > Fraction(1, 2) * Fraction(9, 10)

    ke = replay_key_equity(_returns(), _flows(flows), anchor, history_reaches_inception=True)

    assert ke.degrade_reasons == frozenset({DegradeReason.INCEPTION_UNRECONCILED})


# ── a 2-day opening run (the MT5 pattern) ─────────────────────────────────────

def test_two_day_opening_run_inside_band_does_not_block() -> None:
    """The implied start is read BEFORE THE FIRST flow of the run. Read before the
    second (``s`` + the first deposit, 60% of the book) it would block: this arm
    fails if the check anchors on the wrong day of the run."""
    flows = {-2: 60_000.0, -1: 40_000.0}
    start = _start_for_share(0.5e-4, 100_000.0)
    level_lo, anchor = _exact_book(start, flows)
    assert _share(start, level_lo) < BAND

    ke = replay_key_equity(_returns(), _flows(flows), anchor, history_reaches_inception=True)

    assert ke.is_trustworthy is True
    assert ke.degrade_reasons == frozenset()
    assert ke.flags == {"opening_flows_reconciled": 2}


def test_two_day_opening_run_outside_band_is_unreconciled() -> None:
    flows = {-2: 60_000.0, -1: 40_000.0}
    start = _start_for_share(1.4e-4, 100_000.0)
    level_lo, anchor = _exact_book(start, flows)
    assert _share(start, level_lo) > BAND

    ke = replay_key_equity(_returns(), _flows(flows), anchor, history_reaches_inception=True)

    assert ke.degrade_reasons == frozenset({DegradeReason.INCEPTION_UNRECONCILED})
    assert ke.flags == {"inception_unreconciled_flows": 2}


# ── pre-window flows NOT adjacent to the window keep OUT_OF_WINDOW_FLOW ───────

def test_non_adjacent_pre_window_flow_keeps_out_of_window_flow() -> None:
    """A flow two days before the first return day with the day between EMPTY is not
    an opening run (adjacency is the day immediately before the window)."""
    flows = {-2: 100_000.0}
    start = _start_for_share(0.5e-4, 100_000.0)
    _, anchor = _exact_book(start, flows)

    ke = replay_key_equity(_returns(), _flows(flows), anchor, history_reaches_inception=True)

    assert ke.degrade_reasons == frozenset({DegradeReason.OUT_OF_WINDOW_FLOW})
    assert ke.flags == {"out_of_window_flows": 1}


def test_an_earlier_flow_cut_off_from_the_run_stays_out_of_window() -> None:
    """A run of one flow adjacent to the window, plus an earlier flow with a gap
    between them: the run is judged on its own, the earlier flow stays
    OUT_OF_WINDOW_FLOW (and the count says exactly one)."""
    flows = {-5: 30_000.0, -1: 70_000.0}
    start = _start_for_share(0.5e-4, 100_000.0)
    _, anchor = _exact_book(start, flows)

    ke = replay_key_equity(_returns(), _flows(flows), anchor, history_reaches_inception=True)

    assert DegradeReason.OUT_OF_WINDOW_FLOW in ke.degrade_reasons
    assert ke.flags["out_of_window_flows"] == 1
    assert ke.is_trustworthy is False


# ── a flow AFTER the window keeps OUT_OF_WINDOW_FLOW ──────────────────────────

def test_post_window_flow_keeps_out_of_window_flow_even_with_a_clean_opening() -> None:
    flows = {-1: 100_000.0}
    start = _start_for_share(0.5e-4, 100_000.0)
    # A deposit the day AFTER the last return day: the replay unions it as a later
    # no-return day, so the exact book carries it on a final extra day.
    post = {_N_WINDOW: 5_000.0}
    level_lo, anchor_before = _exact_book(start, flows)
    anchor = anchor_before + 5_000.0  # r = 0 on the extra day: L = L_prev * 1 + F
    assert _share(start, level_lo) < BAND

    ke = replay_key_equity(
        _returns(),
        _flows({**flows, **post}),
        anchor,
        history_reaches_inception=True,
    )

    assert ke.degrade_reasons == frozenset({DegradeReason.OUT_OF_WINDOW_FLOW})
    assert ke.flags["out_of_window_flows"] == 1  # the post-window flow, not the opening one
    assert ke.flags["opening_flows_reconciled"] == 1


# ── a venue without full history: behaviour unchanged ─────────────────────────

def test_venue_without_full_history_is_unchanged() -> None:
    """The default (``history_reaches_inception=False``) is the pre-D-13 rule to the
    letter: the same clean opening deposit that passes above still counts as one
    out-of-window flow, and no inception reason or flag exists."""
    flows = {-1: 100_000.0}
    start = _start_for_share(0.5e-4, 100_000.0)
    _, anchor = _exact_book(start, flows)

    ke = replay_key_equity(_returns(), _flows(flows), anchor)  # default: not full history
    explicit = replay_key_equity(
        _returns(), _flows(flows), anchor, history_reaches_inception=False
    )

    for result in (ke, explicit):
        assert result.degrade_reasons == frozenset({DegradeReason.OUT_OF_WINDOW_FLOW})
        assert result.flags == {"out_of_window_flows": 1}
    assert ke.equity is not None and explicit.equity is not None
    pd.testing.assert_series_equal(ke.equity, explicit.equity)


def test_no_opening_flow_on_a_full_history_venue_is_untouched() -> None:
    """A full-history key with only in-window flows has no opening run to judge."""
    in_window = {3: 2_000.0}
    start = Fraction(250_000)
    # The account was funded before the first return day by something the ledger
    # does not show; with no opening flow there is nothing for D-13 to excuse.
    _, anchor = _exact_book(start, {}, window_flows=in_window)

    ke = replay_key_equity(
        _returns(), [ExternalFlow(_iso(3), 2_000.0)], anchor, history_reaches_inception=True
    )

    assert ke.degrade_reasons == frozenset()
    assert ke.flags == {}


# ── the closed set, the band and the venue list are pinned ────────────────────

def test_reason_is_blocking_and_the_band_and_venues_are_the_founders() -> None:
    assert DegradeReason.INCEPTION_UNRECONCILED.value == "inception_unreconciled"
    assert DegradeReason.INCEPTION_UNRECONCILED in derive._BLOCKING_REASONS
    assert derive._is_trustworthy(frozenset({DegradeReason.INCEPTION_UNRECONCILED})) is False
    assert derive._INCEPTION_ZERO_START_BAND == float(BAND)  # D-14: 0.01%
    assert FULL_HISTORY_VENUES == frozenset({"deribit", "mt5"})


# ── compose wiring: the caller's venue knowledge reaches the replay ───────────

def _compose(full_history_keys: set[str] | None) -> dict:
    flows = {-1: 100_000.0}
    start = _start_for_share(0.5e-4, 100_000.0)
    _, anchor = _exact_book(start, flows)
    return compose_allocator_equity(
        {"key-A": _returns()},
        {"key-A": _flows(flows)},
        {"key-A": anchor},
        full_history_keys=full_history_keys,
    )


def test_compose_passes_full_history_keys_to_the_replay() -> None:
    full = _compose({"key-A"})
    assert "out_of_window_flow" not in full["degrade_reasons"]
    assert full["is_trustworthy"] is True

    other = _compose(None)
    assert "out_of_window_flow" in other["degrade_reasons"]
    assert other["is_trustworthy"] is False

    not_this_key = _compose({"some-other-key"})
    assert "out_of_window_flow" in not_this_key["degrade_reasons"]


# ── job wiring: the key's exchange decides, read from api_keys ────────────────

def _job_inputs(exchange: str) -> dict[str, list[dict]]:
    from tests.test_derive_allocator_equity_job import DERIVED_TABLE

    flows = {-1: 100_000.0}
    start = _start_for_share(0.5e-4, 100_000.0)
    _, anchor = _exact_book(start, flows)
    alloc = "alloc-open"
    return {
        "api_keys": [
            {
                "id": "key-A", "user_id": alloc, "is_active": True,
                "sync_status": "connected", "disconnected_at": None,
                "exchange": exchange, "venue_account_id": "venue-A",
            }
        ],
        "csv_daily_returns": [
            {"api_key_id": "key-A", "allocator_id": alloc, "date": day, "daily_return": r}
            for day, r in _returns().items()
        ],
        DERIVED_TABLE: [
            {
                "allocator_id": alloc,
                "kind": "key_inputs:key-A",
                "payload": {
                    "flows": [{"utc_day_iso": _iso(-1), "usd_signed": 100_000.0}],
                    "anchor_usd": anchor,
                    "anchor_asof": _iso(_N_WINDOW - 1),
                    "venue": exchange,
                },
            }
        ],
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("exchange", "blocked_by_position"),
    [("deribit", False), ("mt5", False), ("MT5", False), ("binance", True), ("okx", True)],
)
async def test_job_reads_the_venue_from_api_keys(exchange: str, blocked_by_position: bool) -> None:
    from unittest.mock import patch

    from services.job_worker import run_derive_allocator_equity_job
    from tests.test_derive_allocator_equity_job import (
        DERIVED_TABLE,
        _extract_payload,
        _FakeSupabase,
        _is_equity_curve_upsert,
    )

    fake = _FakeSupabase(_job_inputs(exchange))
    job = {"id": "j-open", "kind": "derive_allocator_equity", "allocator_id": "alloc-open"}
    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "DONE"
    upserts = [u for u in fake.upserts if u[0] == DERIVED_TABLE and _is_equity_curve_upsert(u[1])]
    assert len(upserts) == 1, fake.upserts
    payload = _extract_payload(upserts[0][1])
    assert ("out_of_window_flow" in payload["degrade_reasons"]) is blocked_by_position
    assert payload["is_trustworthy"] is (not blocked_by_position)


def _job_inputs_post_window_flow(stated: bool, exchange: str = "deribit") -> dict[str, list[dict]]:
    """``_job_inputs`` with a 5000 deposit the day AFTER the last return day, the anchor
    carrying it (r = 0 on that extra day), and, when ``stated``, the day listed in the row's
    ``tiny_base_days`` (234 founder ruling 2026-11-24)."""
    inputs = _job_inputs(exchange)
    flows = {-1: 100_000.0}
    start = _start_for_share(0.5e-4, 100_000.0)
    _, anchor_before = _exact_book(start, flows)
    row = inputs["derived"] if "derived" in inputs else None  # placeholder, replaced below
    del row
    from tests.test_derive_allocator_equity_job import DERIVED_TABLE

    payload = inputs[DERIVED_TABLE][0]["payload"]
    payload["flows"] = [
        {"utc_day_iso": _iso(-1), "usd_signed": 100_000.0},
        {"utc_day_iso": _iso(_N_WINDOW), "usd_signed": 5_000.0},
    ]
    payload["anchor_usd"] = anchor_before + 5_000.0
    payload["anchor_asof"] = _iso(_N_WINDOW)
    if stated:
        payload["tiny_base_days"] = [_iso(_N_WINDOW)]
    return inputs


async def _run_job(inputs: dict[str, list[dict]]):  # type: ignore[no-untyped-def]
    from unittest.mock import patch

    from services.job_worker import run_derive_allocator_equity_job
    from tests.test_derive_allocator_equity_job import (
        DERIVED_TABLE,
        _extract_payload,
        _FakeSupabase,
        _is_equity_curve_upsert,
    )

    fake = _FakeSupabase(inputs)
    job = {"id": "j-open", "kind": "derive_allocator_equity", "allocator_id": "alloc-open"}
    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)
    upserts = [u for u in fake.upserts if u[0] == DERIVED_TABLE and _is_equity_curve_upsert(u[1])]
    return result, fake, [_extract_payload(u[1]) for u in upserts]


@pytest.mark.asyncio
@pytest.mark.parametrize("stated", [True, False], ids=["stated-day", "no-list-control"])
async def test_job_threads_tiny_base_days_to_the_out_of_window_count(stated: bool) -> None:
    result, fake, payloads = await _run_job(_job_inputs_post_window_flow(stated))

    assert result.outcome.name == "DONE"
    assert len(payloads) == 1, fake.upserts
    payload = payloads[0]
    assert ("out_of_window_flow" in payload["degrade_reasons"]) is (not stated)
    assert payload["is_trustworthy"] is stated


# ── 234 founder ruling 2026-11-24: a stated tail day after the last return ────
# A flow after the key's last return day on a day the key's own row states in
# tiny_base_days is a stated day's flow, not an out-of-window flow. The scope is
# exactly that and the arms below pin each edge of it.


def _post_window_book() -> tuple[dict[int, float], float]:
    """A clean opening flow plus a 5000 deposit the day after the last return day, with the
    exact anchor (r = 0 on the extra day), built forward in exact arithmetic."""
    flows = {-1: 100_000.0}
    start = _start_for_share(0.5e-4, 100_000.0)
    _, anchor_before = _exact_book(start, flows)
    return {**flows, _N_WINDOW: 5_000.0}, anchor_before + 5_000.0


def test_a_stated_tail_day_after_the_last_return_is_not_out_of_window() -> None:
    flows, anchor = _post_window_book()

    ke = replay_key_equity(
        _returns(), _flows(flows), anchor, history_reaches_inception=True,
        tiny_base_days=frozenset({_iso(_N_WINDOW)}),
    )

    assert ke.degrade_reasons == frozenset()
    assert "out_of_window_flows" not in ke.flags
    assert ke.flags["opening_flows_reconciled"] == 1
    assert ke.is_trustworthy is True


def test_a_different_stated_day_keeps_the_post_window_flow_counted() -> None:
    flows, anchor = _post_window_book()

    ke = replay_key_equity(
        _returns(), _flows(flows), anchor, history_reaches_inception=True,
        tiny_base_days=frozenset({_iso(_N_WINDOW + 1)}),
    )

    assert DegradeReason.OUT_OF_WINDOW_FLOW in ke.degrade_reasons
    assert ke.flags["out_of_window_flows"] == 1


def test_a_listed_day_before_the_window_is_outside_the_ruling() -> None:
    """The ruling is about days AFTER the last return. A listed earlier day keeps counting."""
    flows = {-5: 30_000.0, -1: 70_000.0}
    start = _start_for_share(0.5e-4, 100_000.0)
    _, anchor = _exact_book(start, flows)

    ke = replay_key_equity(
        _returns(), _flows(flows), anchor, history_reaches_inception=True,
        tiny_base_days=frozenset({_iso(-5)}),
    )

    assert DegradeReason.OUT_OF_WINDOW_FLOW in ke.degrade_reasons
    assert ke.flags["out_of_window_flows"] == 1


def test_a_listed_day_inside_the_window_changes_nothing() -> None:
    """A listed in-window day exempts nothing: the unstated post-window flow still counts."""
    flows, anchor = _post_window_book()

    ke = replay_key_equity(
        _returns(), _flows(flows), anchor, history_reaches_inception=True,
        tiny_base_days=frozenset({_iso(3)}),
    )

    assert DegradeReason.OUT_OF_WINDOW_FLOW in ke.degrade_reasons
    assert ke.flags["out_of_window_flows"] == 1


@pytest.mark.parametrize("absent", [None, frozenset()], ids=["none", "empty"])
def test_an_absent_or_empty_list_is_the_call_without_it(absent: frozenset[str] | None) -> None:
    flows, anchor = _post_window_book()
    plain = replay_key_equity(
        _returns(), _flows(flows), anchor, history_reaches_inception=True,
    )

    ke = replay_key_equity(
        _returns(), _flows(flows), anchor, history_reaches_inception=True,
        tiny_base_days=absent,
    )

    assert ke.degrade_reasons == plain.degrade_reasons
    assert ke.flags == plain.flags
    assert ke.equity is not None and plain.equity is not None
    assert list(ke.equity.items()) == list(plain.equity.items())


@pytest.mark.parametrize("stated", [True, False], ids=["stated-days", "no-list"])
def test_the_exemption_applies_on_the_writer_basis(stated: bool) -> None:
    """Returns on days 0-2, writer day P&L 0.0 on days 0-4, a writer flow of +3.0 on day 3 and
    the realized terminal on day 4: the shape of the Deribit evidence (a flow on a tail day
    past the last return, both days stated)."""
    days = [_iso(i) for i in range(5)]
    flow = ExternalFlow(days[3], 3.0)

    ke = replay_key_equity(
        pd.Series([0.01, 0.0, 0.0], index=days[:3], name="k"),
        [flow],
        100.0,
        realized_terminal=(days[4], 100.0),
        writer_day_pnl={d: 0.0 for d in days},
        writer_flows=[flow],
        tiny_base_days=frozenset({days[3], days[4]}) if stated else None,
    )

    assert ke.flags["writer_basis"] is True
    if stated:
        assert DegradeReason.OUT_OF_WINDOW_FLOW not in ke.degrade_reasons
        assert "out_of_window_flows" not in ke.flags
    else:
        assert DegradeReason.OUT_OF_WINDOW_FLOW in ke.degrade_reasons
        assert ke.flags["out_of_window_flows"] == 1


# ── the strict reader ─────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "payload",
    [{}, {"tiny_base_days": None}, {"tiny_base_days": []}],
    ids=["absent", "null", "empty"],
)
def test_the_reader_reads_an_absent_or_empty_field_as_no_stated_days(payload: dict) -> None:
    assert derive.read_tiny_base_days(payload) == frozenset()


def test_the_reader_returns_the_stated_days() -> None:
    got = derive.read_tiny_base_days({"tiny_base_days": ["2026-11-09", "2026-11-10"]})
    assert got == frozenset({"2026-11-09", "2026-11-10"})


@pytest.mark.parametrize(
    ("stored", "error"),
    [
        ("2026-11-09", TypeError),
        ([20261109], TypeError),
        (["2026-13-01"], ValueError),
        (["2026-11-9"], ValueError),
        (["garbage-day"], ValueError),
    ],
    ids=["not-a-list", "non-string-item", "impossible-day", "non-canonical", "garbage"],
)
def test_the_reader_refuses_a_malformed_list_without_echoing_it(
    stored: object, error: type[Exception]
) -> None:
    with pytest.raises(error) as exc:
        derive.read_tiny_base_days({"tiny_base_days": stored})
    assert "tiny_base_days" in str(exc.value)
    for leaked in ("2026-11-09", "20261109", "2026-13-01", "2026-11-9", "garbage-day"):
        assert leaked not in str(exc.value)


# ── compose wiring ────────────────────────────────────────────────────────────

def _compose_post_window(by_key: dict[str, frozenset[str]] | None) -> dict:
    flows, anchor = _post_window_book()
    return compose_allocator_equity(
        {"key-A": _returns()},
        {"key-A": _flows(flows)},
        {"key-A": anchor},
        full_history_keys={"key-A"},
        tiny_base_days_by_key=by_key,
    )


def test_compose_passes_a_keys_own_stated_days_to_the_replay() -> None:
    mine = _compose_post_window({"key-A": frozenset({_iso(_N_WINDOW)})})
    assert "out_of_window_flow" not in mine["degrade_reasons"]
    assert mine["is_trustworthy"] is True

    other = _compose_post_window({"some-other-key": frozenset({_iso(_N_WINDOW)})})
    assert "out_of_window_flow" in other["degrade_reasons"]
    assert other["is_trustworthy"] is False

    assert "out_of_window_flow" in _compose_post_window(None)["degrade_reasons"]


# ── job: a malformed list is a named corrupt input; a departed key reads its own ──

@pytest.mark.asyncio
@pytest.mark.parametrize("stored", ["2026-11-09", ["garbage-day"]], ids=["not-a-list", "bad-day"])
async def test_job_refuses_a_malformed_tiny_base_days_as_corrupt_input(stored: object) -> None:
    from tests.test_derive_allocator_equity_job import DERIVED_TABLE, _assert_refusal_recorded

    inputs = _job_inputs_post_window_flow(True)
    inputs[DERIVED_TABLE][0]["payload"]["tiny_base_days"] = stored
    result, fake, _ = await _run_job(inputs)

    assert result.outcome.name == "FAILED"
    _assert_refusal_recorded(fake, "alloc-open", "input_corrupt")
    assert "garbage-day" not in repr(result)
    assert "2026-11-09" not in repr(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("stated", [True, False], ids=["stated-day", "no-list"])
async def test_a_departed_key_reads_its_own_stated_days(stated: bool) -> None:
    from tests.test_allocator_equity_departed import (
        ALLOC,
        DAYS,
        _book,
        _live_and_departed,
        _run,
    )
    from tests.test_derive_allocator_equity_job import DERIVED_TABLE, _gate_key

    departed = _gate_key(
        "key-R", ALLOC, venue_account_id="acct-revoked", sync_status="revoked",
    )
    fake = _live_and_departed(departed, DAYS[:8])
    row = next(r for r in fake.rows[DERIVED_TABLE] if r["kind"] == "key_inputs:key-R")
    row["payload"]["flows"] = [{"utc_day_iso": DAYS[8], "usd_signed": 50.0}]
    if stated:
        row["payload"]["tiny_base_days"] = [DAYS[8]]
    result = await _run(fake)

    assert result.outcome.name == "DONE"
    payload = _book(fake)
    assert ("out_of_window_flow" in payload["degrade_reasons"]) is (not stated)
