"""The unknown-type refusal must carry the evidence its own message demands.

⛔ WHY THIS FILE EXISTS — a MEASURED production failure, 2026-09-12.
A real Deribit options account (an Iron Condor) produced:

    unknown Deribit transaction-log type 'assignment' carries nonzero
    change (-1.5e-05); it is in neither CASH_BEARING nor INFORMATIONAL —
    classify it against fresh evidence before ingesting

and that sentence was ALL anyone got. There is no raw transaction-log store, the
credential was later removed, and Deribit does not enumerate the `type` enum in
its published docs — so the one measurement that could have settled the
classification was gone the moment the worker exited. The guard demanded
evidence it never collected.

⭐ The deciding question these tests pin: does the SAME instrument also carry a
`delivery` row? `delivery` is already CASH_BEARING and books option expiry cash.
If both fire, summing `assignment` too DOUBLE-COUNTS realized cash; if only
`assignment` fires, it carries the settlement. The refusal now answers that from
the batch already in memory instead of leaving it to a later guess.

⭐ UPDATED 2026-09-26 (Phase 168): the next occurrence WAS self-evidencing, and
its census is recorded in docs/evidence/drb-assignment-census-2026-09.json.
`assignment` is now classified (cash-bearing only in that census shape), and its
behaviour is pinned in tests/test_deribit_assignment.py. The refusal-channel
tests here therefore use a STILL-UNKNOWN type (``UNKNOWN_ROW``), and each refusal
test asserts the assignment co-occurrence guard's discriminator phrase is ABSENT,
so they keep testing the unknown-type channel and cannot pass on the new guard.
The paragraphs above are kept as lineage.
"""

import pytest

from services.deribit_txn import (
    _ASSIGNMENT_CONTESTED_PHRASE,
    LedgerValuationError,
    describe_unclassified_row,
    txn_rows_to_daily_records,
    txn_rows_to_native_daily,
)

INSTRUMENT = "BTC-12SEP26-60000-C"

# The offending row, reconstructed from the production refusal, carrying
# identifier-shaped fields a blacklist would have leaked.
ASSIGNMENT_ROW = {
    "type": "assignment",
    "currency": "BTC",
    "change": -1.5e-05,
    "instrument_name": INSTRUMENT,
    "timestamp": 1757678400000,
    "user_id": 99999,
    "order_id": "ORDER-THAT-MUST-NOT-LEAK",
    "username": "someone@example.com",
}
# Phase 168: a STILL-UNKNOWN type for the refusal-channel tests. `assignment`
# is classified now (docs/evidence/drb-assignment-census-2026-09.json), so the
# tests that exercise the unknown-type refusal re-point here. It keeps the
# redaction-bait fields and carries its OWN synthetic nonzero change — never the
# value inherited from ASSIGNMENT_ROW.
UNKNOWN_ROW = dict(ASSIGNMENT_ROW, type="mystery_new_type", change=-0.25)
DELIVERY_ROW = {
    "type": "delivery",
    "currency": "BTC",
    "change": 0.004,
    "instrument_name": INSTRUMENT,
    "timestamp": 1757678400000,
}


def test_refusal_carries_the_shape_and_the_sibling_census() -> None:
    """End-to-end: the raised message names the type, the change AND the census.
    It is the UNKNOWN-TYPE refusal, not the assignment co-occurrence guard: the
    guard's discriminator phrase must be absent (it would be present if this
    fixture were still an assignment beside a same-instrument delivery)."""
    with pytest.raises(LedgerValuationError) as exc:
        txn_rows_to_daily_records([UNKNOWN_ROW, DELIVERY_ROW])
    msg = str(exc.value)
    # FIRST: this must be the unknown-type refusal, not the assignment guard.
    assert _ASSIGNMENT_CONTESTED_PHRASE not in msg, msg
    assert UNKNOWN_ROW["type"] in msg
    assert f"({UNKNOWN_ROW['change']})" in msg, msg
    assert "OBSERVED SHAPE:" in msg
    assert f"instrument_name={INSTRUMENT!r}" in msg
    assert "delivery=1" in msg, msg


def test_the_native_sibling_refusal_carries_it_too() -> None:
    """Both refusal sites, not just the USD one — they are VERBATIM twins and a
    fix applied to one of them only is the half-class this repo keeps re-finding."""
    with pytest.raises(LedgerValuationError) as exc:
        txn_rows_to_native_daily([UNKNOWN_ROW, DELIVERY_ROW])
    msg = str(exc.value)
    # FIRST: this must be the unknown-type refusal, not the assignment guard.
    assert _ASSIGNMENT_CONTESTED_PHRASE not in msg, msg
    assert UNKNOWN_ROW["type"] in msg
    assert "OBSERVED SHAPE:" in msg
    assert "delivery=1" in msg, msg


def test_the_census_DISTINGUISHES_the_two_worlds() -> None:
    """CALIBRATION — the whole point. The predicate must FLIP, or it measures
    nothing: `delivery=1` when a sibling delivery exists and `delivery=0` when it
    does not. A census that reported the same number either way would be a
    control that cannot fail."""
    with_delivery = describe_unclassified_row(
        ASSIGNMENT_ROW, [ASSIGNMENT_ROW, DELIVERY_ROW]
    )
    alone = describe_unclassified_row(ASSIGNMENT_ROW, [ASSIGNMENT_ROW])
    assert "delivery=1" in with_delivery
    assert "delivery=0" in alone
    assert with_delivery != alone


def test_identifiers_are_REDACTED_by_whitelist() -> None:
    """⚠️ This text reaches `compute_jobs.last_error` and a customer-facing
    diagnostics panel. The renderer is a WHITELIST, so a field Deribit adds
    tomorrow cannot leak by default."""
    out = describe_unclassified_row(ASSIGNMENT_ROW, [ASSIGNMENT_ROW, DELIVERY_ROW])
    for leaked in ("ORDER-THAT-MUST-NOT-LEAK", "someone@example.com", "99999"):
        assert leaked not in out, f"{leaked!r} leaked into a customer-visible message"


def test_the_census_reports_a_same_instrument_assignment() -> None:
    """SIBLING-REPORTS-ASSIGNMENT (Phase 168, D-04). The next unknown-type
    refusal is likely an option `exercise` or `expiry` (Deribit's transaction-log
    docs list both beside `assignment`). Whether an `assignment` co-occurred on
    the same instrument is the first thing its classification will need, so the
    census must report it — and must FLIP, or it measures nothing."""
    beside = describe_unclassified_row(UNKNOWN_ROW, [UNKNOWN_ROW, ASSIGNMENT_ROW])
    alone = describe_unclassified_row(UNKNOWN_ROW, [UNKNOWN_ROW])
    assert "assignment=1" in beside, beside
    assert "assignment=0" in alone, alone


def test_the_shape_reports_commission_and_position() -> None:
    """SHAPE-REPORTS-FEE-AND-POSITION (Phase 168, CONTEXT discretion). Whether an
    option expiry row carries `commission` and `position` decides whether the
    mark_to_market fee arm and the smoothed replay can read it, so the refusal
    renders both. They are sizes and fees, not identifiers. A row without them
    renders their absence (the field is simply not listed) and never raises."""
    carrying = dict(UNKNOWN_ROW, commission=0.0003, position=-1.0)
    out = describe_unclassified_row(carrying, [carrying])
    assert "commission=0.0003" in out, out
    assert "position=-1.0" in out, out

    bare = describe_unclassified_row(UNKNOWN_ROW, [UNKNOWN_ROW])
    assert bare.startswith("OBSERVED SHAPE: type='mystery_new_type'"), bare
    assert "commission=" not in bare, bare
    assert "position=" not in bare, bare


def test_a_zero_change_unknown_type_still_passes_silently() -> None:
    """UNCHANGED BEHAVIOUR, pinned so this fix cannot widen the refusal. Only a
    NONZERO change was ever loud; a zero-change occurrence is harmlessly ignored,
    and that is why `assignment` rows had almost certainly passed through
    unnoticed before the 2026-09-12 one. Pinned on a still-unknown type: a
    zero-change `assignment` is classified now and emits an empty day record."""
    quiet = dict(UNKNOWN_ROW, change=0.0)
    assert txn_rows_to_daily_records([quiet]) == []


def test_the_renderer_never_raises_on_a_hostile_row() -> None:
    """It runs ONLY on the failing path. An exception here would REPLACE a
    precise refusal with a stack trace — the substitutive-failure shape this
    module guards against everywhere else."""

    class Hostile(dict):
        def get(self, *a, **k):  # noqa: ANN002, ANN003
            raise RuntimeError("hostile row")

    out = describe_unclassified_row(Hostile(), [])
    assert "OBSERVED SHAPE:" in out
