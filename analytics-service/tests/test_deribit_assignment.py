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
    mark-to-market arm treats it as invisible.

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
    _NATIVE_OPTIONS_SUMMARY_TYPES,
    _OPTION_BOOK_EVENT_TYPES,
    _OPTION_EXPIRY_TYPES,
    CASH_BEARING_TYPES,
    LedgerValuationError,
    assert_balance_identity,
    txn_rows_to_daily_records,
    txn_rows_to_native_daily,
)
from tests.test_smoothed_mtm_core import _mk_ms, _opt_row, _run_options_ledger

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
