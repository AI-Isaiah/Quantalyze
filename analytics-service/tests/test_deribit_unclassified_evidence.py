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

⚠️ These tests deliberately do NOT assert any classification for `assignment`.
It is still unclassified on purpose — the fix is that the next occurrence is
self-evidencing, not that we guessed.
"""

import pytest

from services.deribit_txn import (
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
DELIVERY_ROW = {
    "type": "delivery",
    "currency": "BTC",
    "change": 0.004,
    "instrument_name": INSTRUMENT,
    "timestamp": 1757678400000,
}


def test_refusal_carries_the_shape_and_the_sibling_census() -> None:
    """End-to-end: the raised message names the type, the change AND the census."""
    with pytest.raises(LedgerValuationError) as exc:
        txn_rows_to_daily_records([ASSIGNMENT_ROW, DELIVERY_ROW])
    msg = str(exc.value)
    assert "assignment" in msg
    assert "OBSERVED SHAPE:" in msg
    assert f"instrument_name={INSTRUMENT!r}" in msg
    assert "delivery=1" in msg, msg


def test_the_native_sibling_refusal_carries_it_too() -> None:
    """Both refusal sites, not just the USD one — they are VERBATIM twins and a
    fix applied to one of them only is the half-class this repo keeps re-finding."""
    with pytest.raises(LedgerValuationError) as exc:
        txn_rows_to_native_daily([ASSIGNMENT_ROW, DELIVERY_ROW])
    msg = str(exc.value)
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


def test_a_zero_change_unknown_type_still_passes_silently() -> None:
    """UNCHANGED BEHAVIOUR, pinned so this fix cannot widen the refusal. Only a
    NONZERO change was ever loud; a zero-change occurrence is harmlessly ignored,
    and that is why `assignment` rows have almost certainly passed through
    unnoticed before this one."""
    quiet = dict(ASSIGNMENT_ROW, change=0.0)
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
