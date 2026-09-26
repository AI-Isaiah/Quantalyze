"""Phase 168 (DRBOPTIONS): Deribit's `assignment` transaction-log type.

WHY THIS FILE EXISTS. Every Deribit options account whose ledger carried a
nonzero-change `assignment` row failed ingestion on the unknown-type refusal, and
the wizard's Retry could not clear it (the ledger still holds the row). The census
that refusal printed on 2026-09-23 is recorded, counts only, in
docs/evidence/drb-assignment-census-2026-09.json: one `assignment`, side
`close buy`, on an expired BTC put, with same-instrument `delivery=0
settlement=0 trade=1`. So in that shape the `assignment` is the ONLY cash event
of the expiry: skipping it drops realized cash, and the native balance roll
cannot close.

What these tests pin, and why each can fail:
  * D-01 — the census shape ingests end to end and the assignment cash is summed
    ONCE, on both twins (USD per day, native per day and currency), and the
    balance identity closes. Dropping `assignment` from the cash-bearing set turns
    them red (the unknown-type refusal fires instead).
  * D-02 — the UNOBSERVED shape (an assignment beside a same-instrument delivery
    or settlement) refuses on both twins: it neither sums (a possible double
    count) nor skips (a possible dropped expiry). So does an assignment with no
    instrument, because its census cannot be computed.
  * D-03 — the evidence file carries the census and nothing that identifies an
    account, a job, an instrument or a change value (the repo is public).
  * D-07 — the option book vocabulary is one constant that is a subset of the
    cash-bearing set, so no expiry type can be summed as cash while the
    mark-to-market arm treats it as invisible. Each of the option-book sites that
    reads it (pre-coverage flag, trailing activity, summary cross-check, replay,
    the mark_to_market option arm, its non-derivative guard) has its own
    `test_site<N>_*` pin here, each seen red when only that site is reverted to
    the old trade/delivery pair; the mark_to_market and smoothed_mtm end-to-end
    runs (`*_mtm_e2e_*`, `test_smoothed_e2e_*`) pin them through the adapter.

Synthetic identifiers only. No broker call: the end-to-end case runs through the
monkeypatched crawl harness in tests/test_smoothed_mtm_core.py.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable

import pytest

from services.deribit_txn import (
    _ASSIGNMENT_CONTESTED_PHRASE,
    _ASSIGNMENT_UNNAMED_PHRASE,
    _NATIVE_OPTIONS_SUMMARY_TYPES,
    _OPTION_BOOK_EVENT_TYPES,
    _OPTION_EXPIRY_TYPES,
    CASH_BEARING_TYPES,
    LedgerValuationError,
    _assert_smoothed_summary_cross_check,
    _option_activity_after_coverage,
    _pre_coverage_option_days,
    assert_balance_identity,
    replay_option_positions,
    txn_rows_to_daily_records,
    txn_rows_to_native_daily,
)
from tests.test_smoothed_mtm_core import (
    _mk_ms,
    _opt_row,
    _run_options_ledger,
    _series_to_daymap,
)

EVIDENCE_FILE = (
    Path(__file__).resolve().parent.parent
    / "docs"
    / "evidence"
    / "drb-assignment-census-2026-09.json"
)

# A synthetic BTC put, sold on day 1 and assigned at expiry on day 2.
PUT = "BTC-16JAN26-60000-P"
OTHER_PUT = "BTC-16JAN26-50000-P"
DAY_OPEN = "2026-01-15"
DAY_EXPIRY = "2026-01-16"
PREMIUM = 0.05  # synthetic: premium received on the short (opening trade)
ASSIGNED = -0.03  # synthetic: the assignment's expiry cash (nonzero)
INDEX = 60000.0


def _census_rows() -> list[dict[str, Any]]:
    """The census shape (D-03): one opening option trade and one assignment on
    the SAME instrument, side close buy, nonzero change, and NO same-instrument
    delivery or settlement row."""
    opening = _opt_row(
        instrument=PUT, day=DAY_OPEN, change=PREMIUM, position=-1.0, id=1
    )
    opening["side"] = "sell"
    assigned = _opt_row(
        instrument=PUT, day=DAY_EXPIRY, change=ASSIGNED, position=0.0, id=2,
        type="assignment",
    )
    assigned["side"] = "close buy"
    return [opening, assigned]


def _indexed(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Give every BTC row its own event-time index (Pitfall 4): an inverse row
    with no same-day index would raise the D-07 index error on the USD twin and
    mask the behaviour under test."""
    return [dict(r, index_price=INDEX) for r in rows]


def _sibling(type_: str, *, instrument: str = PUT, change: float = 0.02,
             id: int = 3) -> dict[str, Any]:
    return {
        "type": type_,
        "instrument_name": instrument,
        "currency": "BTC",
        "change": change,
        "commission": 0.0,
        "position": 0.0,
        "side": "close buy",
        "timestamp": _mk_ms(DAY_EXPIRY, hour=8),
        "index_price": INDEX,
        "id": id,
    }


TWINS: list[tuple[str, Callable[[list[dict[str, Any]]], Any]]] = [
    ("usd_twin", lambda rows: txn_rows_to_daily_records(rows)),
    ("native_twin", lambda rows: txn_rows_to_native_daily(rows)),
]


# ---------------------------------------------------------------------------
# D-01 — the census shape ingests end to end on both twins.
# ---------------------------------------------------------------------------


def test_census_shape_ingests_end_to_end_through_the_native_ledger(
    monkeypatch: Any,
) -> None:
    """(1) END-TO-END: build_deribit_native_ledger under cash_settlement on the
    census shape. The assignment is the only cash event of the expiry, so the
    BTC native_pnl day map must carry it on its own day and the total must be
    the sum of BOTH changes — a dropped assignment would leave only the premium,
    a double count would not match either day."""
    rows = _census_rows()
    summaries = [
        # Flat terminal book (the put is assigned): equity == Σ cash change.
        {"currency": "BTC", "equity": PREMIUM + ASSIGNED, "session_upl": 0.0,
         "options_value": 0.0}
    ]
    ledger, _report, _stub = _run_options_ledger(
        monkeypatch,
        btc_rows=rows,
        summaries=summaries,
        charts={},
        pnl_basis="cash_settlement",
    )
    got = {
        d.strftime("%Y-%m-%d"): float(v)
        for d, v in ledger.native_pnl["BTC"].items()
    }
    nonzero = {d: v for d, v in got.items() if v != 0.0}
    assert nonzero == pytest.approx({DAY_OPEN: PREMIUM, DAY_EXPIRY: ASSIGNED}, abs=1e-12)
    assert sum(got.values()) == pytest.approx(PREMIUM + ASSIGNED, abs=1e-12)


def test_census_shape_is_summed_once_on_both_twins_and_the_identity_closes() -> None:
    """(2) Both twins directly on the same rows. USD twin: the assignment day is
    emitted as its own record, valued at the row's own index. Native twin: the
    assignment change is booked per (day, currency). The balance identity, whose
    reference set is the native cash-bearing set, closes under cash_settlement —
    it would breach if either side dropped or double-counted the assignment."""
    rows = _indexed(_census_rows())

    usd = txn_rows_to_daily_records(rows)
    by_day = {r["timestamp"][:10]: (r["side"], r["price"]) for r in usd}
    assert by_day[DAY_OPEN] == ("buy", pytest.approx(PREMIUM * INDEX))
    assert by_day[DAY_EXPIRY] == ("sell", pytest.approx(abs(ASSIGNED) * INDEX))
    assert set(by_day) == {DAY_OPEN, DAY_EXPIRY}

    native = txn_rows_to_native_daily(rows, pnl_basis="cash_settlement")
    assert native == {
        "BTC": {DAY_OPEN: pytest.approx(PREMIUM), DAY_EXPIRY: pytest.approx(ASSIGNED)}
    }
    assert_balance_identity(rows, native, pnl_basis="cash_settlement")


# ---------------------------------------------------------------------------
# D-02 — the co-occurring (unobserved) shape refuses on both twins.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("twin_name,twin", TWINS, ids=[t[0] for t in TWINS])
def test_assignment_beside_a_same_instrument_delivery_refuses(
    twin_name: str, twin: Callable[[list[dict[str, Any]]], Any]
) -> None:
    """(3) An assignment whose instrument also carries a delivery row is the
    shape the census never saw: summing both may double-count the expiry,
    skipping the assignment may drop it. Both twins must refuse, with the
    guard's own discriminator phrase (imported from the module, never restated)
    and the whitelist evidence (OBSERVED SHAPE + the same-instrument census)."""
    rows = _indexed(_census_rows()) + [_sibling("delivery")]
    with pytest.raises(LedgerValuationError) as exc:
        twin(rows)
    msg = str(exc.value)
    assert _ASSIGNMENT_CONTESTED_PHRASE in msg, f"{twin_name}: {msg}"
    assert "OBSERVED SHAPE:" in msg, msg
    assert "delivery=1" in msg, msg


# ---------------------------------------------------------------------------
# D-03 — the evidence file carries the census and nothing identifying.
# ---------------------------------------------------------------------------

_FORBIDDEN_EXACT_KEYS = {"change"}
_FORBIDDEN_KEY_FRAGMENTS = (
    "job_id",
    "jobid",
    "correlation",
    "account",
    "strategy",
    "instrument_name",
    "user_id",
    "api_key",
)
# An option instrument (BASE-DDMMMYY-STRIKE-C/P) or any expiry-shaped date token.
_INSTRUMENT_RE = re.compile(r"[A-Z]{2,}[-_][0-9]{1,2}[A-Z]{3}[0-9]{2}|[0-9]{1,2}[A-Z]{3}[0-9]{2}")


def _walk(node: Any, path: str = "$") -> list[tuple[str, str | None, Any]]:
    """Every (path, key, value) in the JSON tree, keys and leaf values alike."""
    out: list[tuple[str, str | None, Any]] = []
    if isinstance(node, dict):
        for k, v in node.items():
            out.append((f"{path}.{k}", k, v))
            out.extend(_walk(v, f"{path}.{k}"))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out.append((f"{path}[{i}]", None, v))
            out.extend(_walk(v, f"{path}[{i}]"))
    return out


def test_census_evidence_file_carries_counts_and_nothing_identifying() -> None:
    """(4) The repo is public and this file is the classification's citation.
    It must carry the census the classification rests on, and it must carry no
    job id, correlation id, account, strategy, instrument name, or change value
    at ANY depth (`change_nonzero` is a boolean and is the only change field)."""
    data = json.loads(EVIDENCE_FILE.read_text(encoding="utf-8"))
    obs = data["observation"]
    assert obs["type"] == "assignment"
    assert obs["currency"] == "BTC"
    assert obs["option_kind"] == "put"
    assert obs["side"] == "close buy"
    assert obs["change_nonzero"] is True
    assert obs["same_instrument_sibling_census"] == {
        "delivery": 0,
        "settlement": 0,
        "trade": 1,
    }
    assert obs["n"] == 1
    for key in ("_evidence", "_generated", "_recorded", "_subject", "_method",
                "deribit_docs_corroboration", "classification_licence", "limits"):
        assert key in data, key

    for where, key, value in _walk(data):
        if key is not None:
            assert key not in _FORBIDDEN_EXACT_KEYS, f"forbidden key at {where}"
            lowered = key.lower()
            for fragment in _FORBIDDEN_KEY_FRAGMENTS:
                assert fragment not in lowered, f"forbidden key {key!r} at {where}"
        if isinstance(value, str):
            assert not _INSTRUMENT_RE.search(value), (
                f"instrument/expiry-shaped string at {where}"
            )
        # No numeric change value can hide in the file: the only numbers are
        # the census counts and n.
        if isinstance(value, float):
            raise AssertionError(f"float value at {where} — the file is counts only")


# ---------------------------------------------------------------------------
# D-07 — the option book vocabulary cannot fork from the cash-bearing set.
# ---------------------------------------------------------------------------


def test_option_book_vocabulary_is_cash_bearing_and_not_a_summary_type() -> None:
    """(5) Every option book event is cash-bearing (else an expiry type could be
    replayed and re-attributed but never summed), `assignment` is an expiry type
    of the book, and it is NOT an options-summary type (the summary set must stay
    disjoint from the cash-bearing set, or the same economics count twice)."""
    assert _OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES
    assert _OPTION_EXPIRY_TYPES == {"delivery", "assignment"}
    assert _OPTION_BOOK_EVENT_TYPES == {"trade", "delivery", "assignment"}
    assert "assignment" not in _NATIVE_OPTIONS_SUMMARY_TYPES


# ---------------------------------------------------------------------------
# D-02 edges — each pinned so a looser guard cannot pass silently.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("twin_name,twin", TWINS, ids=[t[0] for t in TWINS])
def test_settlement_contests_an_assignment_on_the_same_instrument(
    twin_name: str, twin: Callable[[list[dict[str, Any]]], Any]
) -> None:
    """SETTLEMENT-CONTESTS: a same-instrument `settlement` books expiry cash too,
    so it contests the assignment exactly as a `delivery` does."""
    rows = _indexed(_census_rows()) + [_sibling("settlement")]
    with pytest.raises(LedgerValuationError) as exc:
        twin(rows)
    msg = str(exc.value)
    assert _ASSIGNMENT_CONTESTED_PHRASE in msg, f"{twin_name}: {msg}"
    assert "settlement=1" in msg, msg


def test_other_instrument_delivery_does_not_contest() -> None:
    """OTHER-INSTRUMENT-OK: the census is PER INSTRUMENT. A delivery on a
    different put is its own expiry, not a sibling of this assignment, so both
    are summed on both twins — a guard keyed on "any delivery in the batch" would
    refuse every account that ever had an expiry."""
    rows = _indexed(_census_rows()) + [_sibling("delivery", instrument=OTHER_PUT)]

    usd = txn_rows_to_daily_records(rows)
    by_day = {r["timestamp"][:10]: (r["side"], r["price"]) for r in usd}
    assert by_day[DAY_EXPIRY] == (
        "sell", pytest.approx(abs(ASSIGNED + 0.02) * INDEX)
    )

    native = txn_rows_to_native_daily(rows)
    assert native["BTC"][DAY_EXPIRY] == pytest.approx(ASSIGNED + 0.02)


_UNNAMED_CASES = {
    "absent": lambda r: {k: v for k, v in r.items() if k != "instrument_name"},
    "none": lambda r: dict(r, instrument_name=None),
    "blank": lambda r: dict(r, instrument_name="  "),
}


@pytest.mark.parametrize("twin_name,twin", TWINS, ids=[t[0] for t in TWINS])
@pytest.mark.parametrize("case", sorted(_UNNAMED_CASES))
def test_empty_instrument_assignment_refuses(
    case: str, twin_name: str, twin: Callable[[list[dict[str, Any]]], Any]
) -> None:
    """EMPTY-INSTRUMENT: without an instrument the same-instrument census cannot
    be computed, so the licence (which names an option instrument) does not
    apply — fail closed. Matched on the branch's OWN phrase, imported from the
    module: on the native twin a bare raises-check would also pass on the option
    arm's non-derivative refusal, which such a row trips when this branch is
    removed."""
    opening, assigned = _indexed(_census_rows())
    rows = [opening, _UNNAMED_CASES[case](assigned)]
    with pytest.raises(LedgerValuationError, match=re.escape(_ASSIGNMENT_UNNAMED_PHRASE)):
        twin(rows)


def test_empty_batch_is_empty_on_both_twins() -> None:
    """EMPTY-BATCH: no rows, no records — the guard adds no refusal of its own."""
    assert txn_rows_to_daily_records([]) == []
    assert txn_rows_to_native_daily([]) == {}


def test_a_lone_census_shape_assignment_is_summed_on_both_twins() -> None:
    """A single assignment with a named instrument and no sibling at all is the
    census shape too (trade=0 changes nothing about double counting): summed."""
    (_opening, assigned) = _indexed(_census_rows())
    usd = txn_rows_to_daily_records([assigned])
    assert [(r["timestamp"][:10], r["side"], r["price"]) for r in usd] == [
        (DAY_EXPIRY, "sell", pytest.approx(abs(ASSIGNED) * INDEX))
    ]
    assert txn_rows_to_native_daily([assigned]) == {
        "BTC": {DAY_EXPIRY: pytest.approx(ASSIGNED)}
    }


@pytest.mark.parametrize("twin_name,twin", TWINS, ids=[t[0] for t in TWINS])
def test_zero_change_assignment_is_still_guarded(
    twin_name: str, twin: Callable[[list[dict[str, Any]]], Any]
) -> None:
    """ZERO-CHANGE-STILL-GUARDED: the guard fires on EVERY assignment. Letting a
    zero-change one through beside a same-instrument delivery would be a
    decision made on the size of `change` — a magnitude rule, which the
    classification forbids."""
    opening, assigned = _indexed(_census_rows())
    rows = [opening, dict(assigned, change=0.0), _sibling("delivery")]
    with pytest.raises(LedgerValuationError) as exc:
        twin(rows)
    assert _ASSIGNMENT_CONTESTED_PHRASE in str(exc.value), f"{twin_name}: {exc.value}"


@pytest.mark.parametrize("twin_name,twin", TWINS, ids=[t[0] for t in TWINS])
@pytest.mark.parametrize("order", ["assignment_first", "delivery_first"])
def test_order_independent_refusal(
    order: str, twin_name: str, twin: Callable[[list[dict[str, Any]]], Any]
) -> None:
    """ORDER-INDEPENDENT (refusal): crawl concat order is not trusted, so the
    co-occurring pair must refuse whichever row comes first — a guard that only
    looked BACK at earlier rows would pass the assignment-first order."""
    opening, assigned = _indexed(_census_rows())
    delivery = _sibling("delivery")
    rows = (
        [opening, assigned, delivery]
        if order == "assignment_first"
        else [delivery, opening, assigned]
    )
    with pytest.raises(LedgerValuationError) as exc:
        twin(rows)
    assert _ASSIGNMENT_CONTESTED_PHRASE in str(exc.value), f"{twin_name}/{order}"


def test_order_independent_sums() -> None:
    """ORDER-INDEPENDENT (sums): the census-shape sums are identical when the
    batch is reversed, on both twins."""
    rows = _indexed(_census_rows())
    reversed_rows = list(reversed(rows))
    assert txn_rows_to_daily_records(rows) == txn_rows_to_daily_records(reversed_rows)
    assert txn_rows_to_native_daily(rows) == txn_rows_to_native_daily(reversed_rows)


# ---------------------------------------------------------------------------
# D-02 amended — a windowed crawl cannot classify an assignment.
# ---------------------------------------------------------------------------

_FLAT_SUMMARIES = [
    {"currency": "BTC", "equity": PREMIUM + ASSIGNED, "session_upl": 0.0,
     "options_value": 0.0}
]


def test_windowed_refuses_an_assignment(monkeypatch: Any) -> None:
    """WINDOWED-REFUSES: the same-instrument census is only sound over the
    instrument's WHOLE history. A since_ms-cropped crawl could hold the
    assignment and miss its sibling, so it must refuse; the same rows crawled
    in full ingest; and a windowed crawl WITHOUT an assignment is unchanged
    (the backstop is inert off-shape)."""
    with pytest.raises(LedgerValuationError) as exc:
        _run_options_ledger(
            monkeypatch,
            btc_rows=_census_rows(),
            summaries=_FLAT_SUMMARIES,
            charts={},
            pnl_basis="cash_settlement",
            since_ms=1,
        )
    msg = str(exc.value)
    assert "full-history crawl" in msg, msg
    assert "assignment" in msg, msg

    ledger, _r, _s = _run_options_ledger(
        monkeypatch,
        btc_rows=_census_rows(),
        summaries=_FLAT_SUMMARIES,
        charts={},
        pnl_basis="cash_settlement",
        since_ms=None,
    )
    assert "BTC" in ledger.native_pnl

    opening, assigned = _census_rows()
    no_assignment = [opening, dict(assigned, type="delivery")]
    ledger, _r, _s = _run_options_ledger(
        monkeypatch,
        btc_rows=no_assignment,
        summaries=_FLAT_SUMMARIES,
        charts={},
        pnl_basis="cash_settlement",
        since_ms=1,
    )
    assert "BTC" in ledger.native_pnl


async def test_windowed_refuses_before_the_usd_twin(monkeypatch: Any) -> None:
    """WINDOWED-REFUSES-BEFORE-USD-TWIN: the USD twin runs INSIDE the crawl loop,
    per (scope, currency), before the native adapter ever sees the rows. So the
    backstop must fire in the crawl, before the USD twin: on a batch the USD
    twin itself would refuse (the co-occurring shape), a windowed crawl must
    raise the full-history refusal — not the co-occurrence or unknown-type text."""
    from services import deribit_ingest as di
    from tests.test_deribit_ingest import _patch_pipeline

    batch = _indexed(_census_rows()) + [_sibling("delivery")]

    async def _paginate(
        _ex: Any, _scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        return list(batch) if currency == "BTC" else []

    _patch_pipeline(
        monkeypatch,
        scopes=[di.Scope("main", None, True)],
        currencies={"main": ["BTC"]},
        paginate=_paginate,
    )
    with pytest.raises(LedgerValuationError) as exc:
        await di.fetch_deribit_ledger_daily_records(object(), 1)
    msg = str(exc.value)
    assert "assignment classification requires a full-history crawl" in msg, msg
    assert _ASSIGNMENT_CONTESTED_PHRASE not in msg, msg
    assert "unknown Deribit transaction-log type" not in msg, msg


# ---------------------------------------------------------------------------
# D-07 / D-04 — each option-book site treats `assignment` like `delivery`.
#
# Plan 01 swapped six literal ("trade", "delivery") sites to the shared
# vocabulary constants. Each test below pins ONE site, so reverting that site
# alone to the old pair turns its test red: a mark_to_market double count, an
# un-zeroed assigned short, or a silently mis-routed expiry cannot come back
# without a named failure. The seventh site (the acceptance script's eligibility
# check) is pinned in tests/test_deribit_acceptance.py.
# ---------------------------------------------------------------------------

# The (non-assignment) commission on the synthetic assignment rows below.
ASSIGNED_FEE = 0.0005


def _summary(
    day: str, *, hour: int = 8, rpl: float = 0.0, upl: float = 0.0, id: int = 900
) -> dict[str, Any]:
    """A synthetic BTC options_settlement_summary. Its instrument_name is the
    assigned put's: a summary is not a delivery or settlement, so it must NOT
    contest the assignment (the D-02 guard is type-scoped)."""
    return {
        "type": "options_settlement_summary",
        "instrument_name": PUT,
        "currency": "BTC",
        "change": 0.0,
        "realized_pl": rpl,
        "unrealized_pl": upl,
        "timestamp": _mk_ms(day, hour),
        "id": id,
    }


def _assignment(
    day: str, *, instrument: str = PUT, change: float = ASSIGNED,
    commission: float = ASSIGNED_FEE, position: float = 0.0, id: int = 2,
    hour: int = 10,
) -> dict[str, Any]:
    row = _opt_row(
        instrument=instrument, day=day, change=change, position=position, id=id,
        type="assignment", commission=commission,
    )
    row["timestamp"] = _mk_ms(day, hour)
    row["side"] = "close buy"
    return row


def test_site1_pre_coverage_flags_an_assignment_day() -> None:
    """SITE1-PRE-COVERAGE-FLAG (`_pre_coverage_option_days`): an assignment
    before its currency's summary coverage is booked at its full cash change
    (the pre-rollout fallback), so its day must be flagged for the
    complete_with_warnings stamp exactly as a delivery day is. Reverting the
    site to the old pair drops the flag: the day ships as a clean covered day."""
    rows = [_summary("2026-01-20"), _assignment("2026-01-16")]
    assert _pre_coverage_option_days(rows) == [("BTC", "2026-01-16")]


def test_site2_trailing_assignment_marks_its_currency() -> None:
    """SITE2-TRAILING-ACTIVITY (`_option_activity_after_coverage`): an
    assignment after the last summary is trailing-edge option activity, so its
    currency must be exempted from the strict mark_to_market identity (the §5
    gate reconciles it). Reverting the site leaves the currency unmarked and the
    strict guard false-fires on a healthy account."""
    rows = [_summary("2026-01-15"), _assignment("2026-01-16")]
    assert _option_activity_after_coverage(rows) == frozenset({"BTC"})


def _cross_check_rows(*, with_assignment: bool) -> list[dict[str, Any]]:
    # Sold one put at 01-15 10:00 (premium 0.04, fee 0.01 -> change +0.03) and
    # were assigned at 01-15 14:00 (payout 0.02, no fee -> change -0.02). The
    # summary at 01-16 08:00 settles that session: rpl = 0.04 - 0.02 = 0.02, gross
    # of fees, flat at both window ends (so ΔBook = 0).
    opening = _opt_row(
        instrument=PUT, day=DAY_OPEN, change=0.03, position=-1.0, id=1
    )
    rows = [opening, _summary(DAY_EXPIRY, rpl=0.02)]
    if with_assignment:
        rows.append(
            _assignment(DAY_OPEN, change=-0.02, commission=0.0, hour=14)
        )
    return rows


def test_site3_cross_check_includes_the_assignment() -> None:
    """SITE3-CROSS-CHECK-INCLUDES (`_assert_smoothed_summary_cross_check`):
    Deribit's own session P&L carries the assignment's economics, so our
    reconstruction must include the assignment's change plus commission inside
    the window. Built so that leaving the assignment out breaches (the second
    half proves it): reverting the site to the old pair raises on a summary that
    is right."""
    throughput = {"BTC": 0.05}
    _assert_smoothed_summary_cross_check(
        _cross_check_rows(with_assignment=True), {}, {}, throughput
    )
    # Calibration: the same summary WITHOUT the assignment row in the
    # reconstruction is a real breach, so the pass above is not vacuous.
    with pytest.raises(LedgerValuationError, match="summary cross-check breach"):
        _assert_smoothed_summary_cross_check(
            _cross_check_rows(with_assignment=False), {}, {}, throughput
        )


def test_site4_replay_zeroes_the_assigned_short() -> None:
    """SITE4-REPLAY-ZEROES-SHORT (`replay_option_positions`): an assignment
    closes the assigned short (its post-event position is 0). The replay must
    see it, or the smoothed book carries a short position past its expiry and
    marks a position the account no longer holds."""
    rows = _census_rows()
    book = replay_option_positions(rows)
    assert set(book) == {PUT}
    assert book[PUT]["positions"] == {DAY_OPEN: -1.0, DAY_EXPIRY: 0.0}
    assert book[PUT]["last_day"] == DAY_EXPIRY


_MISSING_FIELD_CASES = {
    "absent": lambda r, f: {k: v for k, v in r.items() if k != f},
    "none": lambda r, f: dict(r, **{f: None}),
    "blank": lambda r, f: dict(r, **{f: "  "}),
}


@pytest.mark.parametrize("case", sorted(_MISSING_FIELD_CASES))
def test_site4_missing_position_refuses(case: str) -> None:
    """SITE4-MISSING-POSITION: the post-event position is the ONLY book source,
    so an assignment without it refuses (never defaulted to 0, which would look
    like a correct close). Matched on the replay guard's own wording."""
    opening, assigned = _census_rows()
    rows = [opening, _MISSING_FIELD_CASES[case](assigned, "position")]
    with pytest.raises(
        LedgerValuationError, match="absent/null/blank/non-numeric position"
    ) as exc:
        replay_option_positions(rows)
    assert "type='assignment'" in str(exc.value)


def _mtm_rows() -> list[dict[str, Any]]:
    # Coverage window [01-13 08:00, 01-18 08:00]; the summaries carry no P&L so
    # the only native entries come from the assignment rows under test.
    inside = _assignment("2026-01-16")
    outside = _assignment("2026-01-20", instrument=OTHER_PUT, id=3)
    return [_summary("2026-01-14", id=901), _summary("2026-01-18", id=902),
            inside, outside]


def test_site5_mtm_inside_coverage_contributes_minus_commission() -> None:
    """SITE5-MTM-INSIDE-COVERAGE (the option arm of `txn_rows_to_native_daily`):
    under mark_to_market the summary channel carries the expiry cash inside its
    coverage, so an assignment there contributes ONLY its fee, exactly as a
    delivery does. Outside coverage it keeps its full change (cash fallback).
    Reverting the site double counts: the full change AND the summary."""
    native = txn_rows_to_native_daily(_mtm_rows(), pnl_basis="mark_to_market")
    assert native == {
        "BTC": {
            "2026-01-16": pytest.approx(-ASSIGNED_FEE),
            "2026-01-20": pytest.approx(ASSIGNED),
        }
    }


@pytest.mark.parametrize("case", sorted(_MISSING_FIELD_CASES))
def test_site5_missing_commission_refuses(case: str) -> None:
    """SITE5-MISSING-COMMISSION: inside coverage the fee is the assignment's
    only contribution, so a missing commission refuses rather than defaulting to
    zero (which would silently drop the fee)."""
    rows = _mtm_rows()
    rows[2] = _MISSING_FIELD_CASES[case](rows[2], "commission")
    with pytest.raises(LedgerValuationError, match="absent/null commission") as exc:
        txn_rows_to_native_daily(rows, pnl_basis="mark_to_market")
    assert "type='assignment'" in str(exc.value)


# The native twin's non-derivative guard wording, as that guard emits it.
_NON_DERIVATIVE_WORDING = "names an unclassifiable or spot instrument yet carries nonzero cash"


@pytest.mark.parametrize("instrument", ["BTC_USDC", "BTC"], ids=["spot", "unknown"])
def test_site6_spot_named_assignment_refuses(instrument: str) -> None:
    """SITE6-SPOT-NAMED-REFUSES (the option arm's non-derivative guard): an
    expiry event always names an expiring derivative, so an assignment naming a
    spot pair or an unclassifiable name with nonzero cash refuses rather than
    being booked on a guessed channel. The instrument is NON-BLANK, so plan 01's
    unnamed-instrument refusal cannot fire first; the message is the
    non-derivative guard's and nothing else, and names the row by type and id
    only (never its change)."""
    rows = [_assignment(DAY_EXPIRY, instrument=instrument)]
    with pytest.raises(LedgerValuationError) as exc:
        txn_rows_to_native_daily(rows)
    msg = str(exc.value)
    assert _ASSIGNMENT_UNNAMED_PHRASE not in msg, msg
    assert _NON_DERIVATIVE_WORDING in msg, msg
    assert "Deribit assignment row id=2" in msg, msg
    assert repr(ASSIGNED) not in msg, msg


async def test_site5_mtm_e2e_assignment_through_the_native_ledger(
    monkeypatch: Any,
) -> None:
    """SITE5-MTM-E2E: a covered BTC options account through the REAL adapter
    under mark_to_market. The assignment is inside coverage, so its day carries
    minus its commission and NOT its change (the summary carries the expiry
    economics); the ledger builds, so `assert_balance_identity` closes; and
    `combine_native_ledger` returns a returns series without raising. The
    summaries share the option rows' instrument_name, so this also pins that the
    D-02 guard contests only delivery and settlement rows.

    Arithmetic: trade change +1.0, fee 0.01; assignment change −0.4, fee 0.02.
    The carrying summary's rpl = Σ(change + commission) = 1.01 − 0.38 = 0.63, and
    the anchor equity = Σchange = 0.6 (flat book, zero inception capital, the
    same arithmetic as the covered-options model test)."""
    import pandas as pd

    from services import deribit_ingest as di
    from services.broker_dailies import combine_native_ledger
    from tests.test_deribit_ingest import (
        _NativeAnchorStub,
        _btc_option_trade,
        _btc_summary,
        _patch_jul_index,
        _patch_pipeline,
    )

    assignment = dict(
        _btc_option_trade(13, change=-0.4, commission=0.02), type="assignment"
    )

    async def _paginate(
        _ex: Any, _scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency == "BTC":
            return [
                _btc_summary(11, rpl=0.0, upl=0.0),     # lower window bound
                _btc_summary(14, rpl=0.63, upl=0.0),    # carries the economics
                _btc_option_trade(12, change=1.0, commission=0.01),
                assignment,
            ]
        return []

    _patch_pipeline(
        monkeypatch,
        scopes=[di.Scope("main", None, True)],
        currencies={"main": ["BTC"]},
        paginate=_paginate,
    )
    _patch_jul_index(monkeypatch)
    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 0.6, "session_upl": 0.0}],
        index_price={"BTC": 60000.0},
    )
    ledger, report = await di.build_deribit_native_ledger(
        ex, pnl_basis="mark_to_market"
    )

    btc = ledger.native_pnl["BTC"]
    assert btc.loc[pd.Timestamp("2025-07-13")] == pytest.approx(-0.02, abs=1e-9)
    assert btc.loc[pd.Timestamp("2025-07-12")] == pytest.approx(-0.01, abs=1e-9)
    assert btc.loc[pd.Timestamp("2025-07-14")] == pytest.approx(0.63, abs=1e-9)
    assert float(btc.sum()) == pytest.approx(0.6, abs=1e-9)
    assert report.pre_coverage_option_days == []

    returns, _meta = combine_native_ledger(ledger, report.indexable_currencies)
    assert isinstance(returns, pd.Series)


def test_smoothed_e2e_short_put_assigned_ingests_flat(monkeypatch: Any) -> None:
    """SMOOTHED-E2E: a short put opened by a trade and closed by an assignment
    ingests under smoothed_mtm through the real adapter. The replay zeroes the
    short on the assignment day, so the book is marked on each held day and is
    zero from the assignment day on. Asserting the DAY MAP (not only the sum) is
    what makes a replay that keeps the short open visible.

    Book = position × mark: −1 × 0.05 (01-15), −1 × 0.06 (01-16), 0 (01-17) ⇒
    ΔMTM −0.05, −0.01, +0.06. Cash: +0.04 premium (01-15), −0.03 assignment
    (01-17). Merged: −0.01, −0.01, +0.03; Σ == Σ cash == +0.01 (flat terminal)."""
    short_put = "BTC-17JAN26-60000-P"
    opening = _opt_row(
        instrument=short_put, day="2026-01-15", change=0.04, position=-1.0, id=1
    )
    opening["side"] = "sell"
    assigned = _opt_row(
        instrument=short_put, day="2026-01-17", change=-0.03, position=0.0, id=2,
        type="assignment",
    )
    assigned["side"] = "close buy"
    ledger, _report, _stub = _run_options_ledger(
        monkeypatch,
        btc_rows=[opening, assigned],
        summaries=[{"currency": "BTC", "equity": 0.01, "session_upl": 0.0,
                    "options_value": 0.0}],
        charts={short_put: {"2026-01-15": 0.05, "2026-01-16": 0.06}},
        pnl_basis="smoothed_mtm",
    )
    got = _series_to_daymap(ledger.native_pnl["BTC"])
    assert got == pytest.approx(
        {"2026-01-15": -0.01, "2026-01-16": -0.01, "2026-01-17": 0.03}, abs=1e-9
    )
    assert sum(got.values()) == pytest.approx(0.04 - 0.03, abs=1e-9)


# ---------------------------------------------------------------------------
# Round-1 review fixes (168-REVIEW.md, 168-REVIEW-SFH.md).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("twin_name,twin", TWINS, ids=[t[0] for t in TWINS])
def test_sfh06_one_non_mapping_row_does_not_blank_the_refusal_evidence(
    twin_name: str, twin: Callable[[list[dict[str, Any]]], Any]
) -> None:
    """SFH-06: the crawl hands the USD twin the unfiltered page, so a batch can
    hold a non-Mapping entry. The refusal's evidence (the census this phase's
    method relies on) must survive it: one bad row is skipped in the census, it
    does not replace the whole shape with `<unrenderable: ...>`."""
    rows: list[Any] = _indexed(_census_rows()) + [42, _sibling("delivery")]
    with pytest.raises(LedgerValuationError) as exc:
        twin(rows)
    msg = str(exc.value)
    assert _ASSIGNMENT_CONTESTED_PHRASE in msg, f"{twin_name}: {msg}"
    assert "<unrenderable" not in msg, msg
    assert "delivery=1" in msg, msg


@pytest.mark.parametrize("twin_name,twin", TWINS, ids=[t[0] for t in TWINS])
@pytest.mark.parametrize(
    "variant", [PUT.lower(), f"  {PUT} "], ids=["lower_case", "padded"]
)
def test_sfh05_a_case_or_space_variant_sibling_still_contests(
    variant: str, twin_name: str, twin: Callable[[list[dict[str, Any]]], Any]
) -> None:
    """SFH-05: `classify_instrument` upper-cases before classifying, so a
    delivery on a case- or whitespace-variant of the assigned put is still an
    option delivery and is summed. It must therefore also CONTEST the
    assignment, or the expiry cash is counted twice. The census in the message
    counts it too, so the evidence agrees with the refusal."""
    rows = _indexed(_census_rows()) + [_sibling("delivery", instrument=variant)]
    with pytest.raises(LedgerValuationError) as exc:
        twin(rows)
    msg = str(exc.value)
    assert _ASSIGNMENT_CONTESTED_PHRASE in msg, f"{twin_name}: {msg}"
    assert "delivery=1" in msg, msg


@pytest.mark.parametrize("twin_name,twin", TWINS, ids=[t[0] for t in TWINS])
@pytest.mark.parametrize(
    "bad_name", [12345, {"name": PUT}, ["x"]], ids=["int", "dict", "list"]
)
def test_sfh05_a_non_string_instrument_is_unnamed(
    bad_name: Any, twin_name: str, twin: Callable[[list[dict[str, Any]]], Any]
) -> None:
    """SFH-05: a non-string instrument_name names no instrument. It used to pass
    the unnamed check (which tested only None and blank strings) and be summed by
    the USD twin. It must refuse with the unnamed branch's OWN phrase on both
    twins."""
    opening, assigned = _indexed(_census_rows())
    rows = [opening, dict(assigned, instrument_name=bad_name)]
    with pytest.raises(LedgerValuationError) as exc:
        twin(rows)
    assert _ASSIGNMENT_UNNAMED_PHRASE in str(exc.value), f"{twin_name}: {exc.value}"


@pytest.mark.parametrize("twin_name,twin", TWINS, ids=[t[0] for t in TWINS])
def test_sfh02_a_second_same_instrument_assignment_contests(
    twin_name: str, twin: Callable[[list[dict[str, Any]]], Any]
) -> None:
    """SFH-02: the census is n=1. Two assignments on one instrument (a partial
    lot split, or a replayed row) is as unobserved as an assignment beside a
    delivery, and summing both double-counts the expiry cash. It must refuse on
    both twins. The self-skip is by identity, so a lone assignment still passes
    (`test_a_lone_census_shape_assignment_is_summed_on_both_twins`)."""
    opening, assigned = _indexed(_census_rows())
    second = dict(assigned, id=5)
    with pytest.raises(LedgerValuationError) as exc:
        twin([opening, assigned, second])
    msg = str(exc.value)
    assert _ASSIGNMENT_CONTESTED_PHRASE in msg, f"{twin_name}: {msg}"
    assert "assignment=1" in msg, msg


@pytest.mark.parametrize("twin_name,twin", TWINS, ids=[t[0] for t in TWINS])
@pytest.mark.parametrize("sibling_type", ["delivery", "settlement"])
def test_sfh03_the_contested_refusal_names_the_contesting_row(
    sibling_type: str, twin_name: str,
    twin: Callable[[list[dict[str, Any]]], Any],
) -> None:
    """SFH-03: the refusal is permanent (every recompute re-raises it), so it
    must name the row that contested the assignment, by venue row id and type.
    Without it an operator cannot tell which ledger row to look at. Venue row
    ids are not secret (the assignment's own id is already printed); the change
    value is not echoed."""
    rows = _indexed(_census_rows()) + [_sibling(sibling_type, id=77, change=0.0123)]
    with pytest.raises(LedgerValuationError) as exc:
        twin(rows)
    msg = str(exc.value)
    assert f"contesting row id=77 type={sibling_type!r}" in msg, f"{twin_name}: {msg}"
    assert "0.0123" not in msg, msg
