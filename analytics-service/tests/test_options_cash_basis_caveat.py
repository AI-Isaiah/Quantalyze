"""Phase 185 (DERIBITFLOWTIME) plan 04 - the interim options caveat flag, writer half (SC-3, D-04).

A Deribit allocator book values open options at CASH today: the key-mode derive runs only the
cash-settlement pass (the mark-to-market and smoothed passes are gated on ``not is_key_mode``), so
an option premium books as a loss on the buy day and the payout as a gain on the close day, against
a cash wallet that excludes the option book. That is the mechanism the 185 re-crawl found (verdict
B, ``185-01-SUMMARY``) behind day returns of several hundred percent.

D-04 (founder 2026-11-01, "Keep the interim caveat on the book") keeps a caveat on the book until
options are valued at market in key mode. This module pins the WRITER half: a key-mode Deribit
derive whose ledger has option activity, and whose returns are on the cash basis, stores
``options_cash_basis: true`` in the key's ``key_inputs`` payload. The flag is a bool, present only
when true, and a derive without option activity writes no such key.

Why a NEW flag and not ``flow_timing_day_level_large`` (RESEARCH Q8): that label's sentence is
about deposits and withdrawals and fires only on a large-flow day, so on an option-premium day it
would be false or silent. A caveat that is false is worse than none. Plan 185-08 narrows this
trigger from "has option activity" to "ended on the cash basis", which makes the flag self-clearing
per derive once the options basis ships.

Network-free: every I/O primitive is a stub, as in ``test_mtm_single_key.py`` whose helpers this
module reuses (the key-mode Deribit derive wiring is the same).

Neuter-falsifiability (test -> mutation it kills):
  * ``test_key_mode_options_book_on_cash_carries_the_caveat`` - kills dropping the write, or
    gating it on something an option-activity cash derive does not satisfy.
  * ``test_key_mode_perp_only_book_writes_no_caveat`` - kills writing the flag unconditionally
    (it would claim a caveat on a book that has no options).
  * ``test_the_caveat_is_raised_only_by_a_strict_true`` - kills loosening the setter's
    ``is True`` to plain truthiness (T-185-12): a report value of 1 or "true" is not the bool
    the producer contract promises, and the flag must not be raised from it. Task 3 proves
    the pin bites with a neuter drill on the writer.

F3 (founder 2026-11-01, D-09): trigger a. The flag is raised by option activity on the cash
basis alone, with no invented return threshold, so there is no threshold test here.
"""
from __future__ import annotations

import dataclasses
from unittest.mock import MagicMock

import pandas as pd
import pytest

from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from tests.test_allocator_equity_dropped_day_pnl import _key_inputs_payload
from tests.test_mtm_single_key import (
    _apply,
    _base_patches,
    _cash_series,
    _ctx,
    _ledger_meta,
    _recording_ledger,
    _report,
)

_KEY_ID = "key-drb"
_FLAG = "options_cash_basis"


async def _run_key_mode_derive(has_option_activity: bool) -> dict:
    """One key-mode Deribit derive on the cash basis; returns its persisted ``key_inputs`` payload."""
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    ledger_mock, _calls = _recording_ledger([_report(has_option_activity=has_option_activity)])
    combine = MagicMock(return_value=(_cash_series(), _ledger_meta()))
    with _apply(_base_patches(ctx, key_mode=True, ledger_mock=ledger_mock, combine_mock=combine)):
        result = await run_derive_broker_dailies_job({"api_key_id": _KEY_ID})
    assert result.outcome == DispatchOutcome.DONE
    return _key_inputs_payload(capture, _KEY_ID)


@pytest.mark.asyncio
async def test_key_mode_options_book_on_cash_carries_the_caveat() -> None:
    payload = await _run_key_mode_derive(has_option_activity=True)
    assert payload.get(_FLAG) is True
    # The payload is the real epilogue row, not an empty stand-in: its existing fields are intact.
    assert payload["native_inception"] == "reconciled"


@pytest.mark.asyncio
async def test_key_mode_perp_only_book_writes_no_caveat() -> None:
    payload = await _run_key_mode_derive(has_option_activity=False)
    assert _FLAG not in payload
    assert payload["native_inception"] == "reconciled"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("value", "expect_flag"),
    [(True, True), (1, False), ("true", False)],
    ids=["strict-true", "int-one", "string-true"],
)
async def test_the_caveat_is_raised_only_by_a_strict_true(value: object, expect_flag: bool) -> None:
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    report = dataclasses.replace(_report(has_option_activity=False), has_option_activity=value)
    ledger_mock, _calls = _recording_ledger([report])
    combine = MagicMock(return_value=(_cash_series(), _ledger_meta()))
    with _apply(_base_patches(ctx, key_mode=True, ledger_mock=ledger_mock, combine_mock=combine)):
        result = await run_derive_broker_dailies_job({"api_key_id": _KEY_ID})
    assert result.outcome == DispatchOutcome.DONE
    payload = _key_inputs_payload(capture, _KEY_ID)
    if expect_flag:
        assert payload.get(_FLAG) is True
    else:
        assert _FLAG not in payload


# 185 WR-03 / D-13 (founder 2026-11-01): the writer classifies EVERY Deribit key-mode derive.
# ``options_activity`` is a bool stamped on the key's ``key_inputs`` payload whether or not the key
# trades options, so a reader can tell a key this writer classified (perp-only: False) from a row it
# never touched (frozen, departed: no key at all) and fail toward the caveat on the latter.
#   * ``test_every_key_mode_deribit_payload_is_stamped_with_options_activity`` kills dropping the
#     stamp, or writing it only when True (the perp-only False is the whole point).
#   * ``test_options_activity_is_stamped_only_from_a_strict_true`` kills loosening the setter's
#     ``is True`` to truthiness: a report value of 1 or "true" is not option activity.
_ACTIVITY = "options_activity"


@pytest.mark.asyncio
@pytest.mark.parametrize("has_option_activity", [True, False], ids=["options-key", "perp-only-key"])
async def test_every_key_mode_deribit_payload_is_stamped_with_options_activity(
    has_option_activity: bool,
) -> None:
    payload = await _run_key_mode_derive(has_option_activity=has_option_activity)
    assert payload.get(_ACTIVITY) is has_option_activity


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("value", "expected"),
    [(True, True), (1, False), ("true", False)],
    ids=["strict-true", "int-one", "string-true"],
)
async def test_options_activity_is_stamped_only_from_a_strict_true(
    value: object, expected: bool
) -> None:
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    report = dataclasses.replace(_report(has_option_activity=False), has_option_activity=value)
    ledger_mock, _calls = _recording_ledger([report])
    combine = MagicMock(return_value=(_cash_series(), _ledger_meta()))
    with _apply(_base_patches(ctx, key_mode=True, ledger_mock=ledger_mock, combine_mock=combine)):
        result = await run_derive_broker_dailies_job({"api_key_id": _KEY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert _key_inputs_payload(capture, _KEY_ID).get(_ACTIVITY) is expected
