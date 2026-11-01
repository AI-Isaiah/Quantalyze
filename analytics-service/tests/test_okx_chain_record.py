"""The chain diagnostic's record (Phase 179 OKXBILLSCHAIN, plan 01).

WHY these tests exist (Rule 9): the probe's lines are pasted into a tracked file in a public
repo, and the chain diagnostic reads exactly the numbers that must not leak there: running
balances, bill ids, tickers. The emitter's refusal is the last thing standing between an
amount and a tracked file, so these tests prove it can FAIL: each declared key refuses a value
outside its vocabulary, by key name and never by value, and a distinctive seeded amount or a
ten-digit bill id never reaches the emitted line. They also pin the census (the three record
structures cannot drift apart) and the diagnostic's failure handling (a failed read is
recorded by exception CLASS and by step, never by message, and never discards the keys
measured before it).

These tests are pure: they never go through ``hp.run()``; the end-to-end path lives in
``tests/test_allocator_history_probe.py``.
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
from collections import Counter
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import ccxt.async_support as ccxt
import pytest

import scripts.okx_chain_record as rec
from scripts.bybit_upnl_probe import FIELD_ABSENT
from scripts.deribit_ground_truth import _DENY_KEY_SUBSTRINGS
from services import okx_bills_chain as chain
from services import okx_opening_balance as obal
from tests._okx_bills import (
    OkxBalanceSequence,
    OkxBillsArchive,
    okx_balance_payload,
    okx_bill,
    okx_detail,
    okx_subtypes_payload,
)

OPENING_DAY = date(2026, 4, 6)
OPENING_MS = int(datetime(2026, 4, 6, tzinfo=timezone.utc).timestamp() * 1000)
DAY_MS = 24 * 60 * 60 * 1000

# Distinctive synthetic amounts and ids: a substring search for one in the output cannot be
# confused with a count's digits.
_SEEDED_LEAKS = ("4444444", "61234", "41237", "19997", "fake-key-id-okx", "signature", "abc123", "4321.5")


# ---------------------------------------------------------------------------
# Census: the three structures name the same keys, and the probe carries them last.
# ---------------------------------------------------------------------------


def test_the_keys_defaults_and_validators_name_the_same_keys() -> None:
    assert len(set(rec.CHAIN_KEYS)) == len(rec.CHAIN_KEYS)  # no duplicate key
    assert set(rec.CHAIN_KEYS) == set(rec.chain_defaults()) == set(rec.CHAIN_VALIDATORS)


def test_no_chain_key_name_contains_a_deny_substring() -> None:
    """assert_sanitized REMOVES nothing: it refuses a record outright when a key contains one of
    these, so a chain key named after one would make the whole line unprintable."""
    for key in rec.CHAIN_KEYS:
        assert key.startswith("chain_"), key
        assert not any(sub in key.lower() for sub in _DENY_KEY_SUBSTRINGS), key


# ---------------------------------------------------------------------------
# Redaction (mutation N8): each bad value is refused by key name, never by value.
# ---------------------------------------------------------------------------


def _exchange(
    archive: OkxBillsArchive, balances: list[Any], *, recent: OkxBillsArchive | None = None
) -> SimpleNamespace:
    """The venue the chain diagnostic reads. Plan 179-02 adds the 7-day store (empty unless
    given) and a subtypes reply naming one type, so a full run makes 1 + 1 + 1 + 6 sweep reads."""

    async def _subtypes(params: dict[str, str]) -> Any:
        return okx_subtypes_payload({"2": ["1"]})

    return SimpleNamespace(
        private_get_account_bills_archive=archive,
        private_get_account_balance=OkxBalanceSequence(balances),
        private_get_account_bills=recent if recent is not None else OkxBillsArchive([]),
        private_get_account_subtypes=_subtypes,
    )


def _break_bills() -> OkxBillsArchive:
    """USDT breaks an interior link (61234 - 41237 is 19997, not 20000); BTC's close breaks
    against the cash read before the walk (0.9) and holds against the one after it (1)."""
    return OkxBillsArchive(
        [
            okx_bill(4444444001, OPENING_MS - 5 * DAY_MS, "USDT", "61234", "5"),
            okx_bill(4444444010, OPENING_MS + 3_600_000, "USDT", "61234", "0"),
            okx_bill(4444444011, OPENING_MS + 7_200_000, "BTC", "1", "1"),
            okx_bill(4444444012, OPENING_MS + 9_000_000, "USDT", "20000", "-41237"),
        ]
    )


def _payload(btc_cash: str) -> Any:
    return okx_balance_payload(
        "70000", [okx_detail("USDT", "20000", eq_usd="20000"), okx_detail("BTC", btc_cash, eq_usd="50000")]
    )


async def _seeded_values() -> dict[str, Any]:
    """``measure_chain`` on a seeded fake: the values the probe would really print."""
    exchange = _exchange(_break_bills(), [_payload("0.9"), _payload("1")])
    row = (await obal.read_okx_balance_row(exchange)) or {}
    reading = await obal.read_okx_opening(exchange, None, OPENING_DAY, row)
    assert reading.unavailable_reason == "chain_break"
    return await rec.measure_chain(exchange, reading, row, OPENING_DAY)


_BAD_VALUES: list[tuple[str, Any]] = [
    ("chain_ccys_checked", 1.5),  # a float where a count is declared
    ("chain_interior_links", True),  # True where a count is declared
    ("chain_calls", -1),  # a negative count
    ("chain_worst_ccy", "PEPE"),  # a ticker outside the closed vocabulary
    ("chain_worst_ccy", "4444444010"),  # a ten-digit bill id
    ("chain_arm", "partial"),  # an arm that does not exist
    ("chain_arm", "A" * 40),  # a 40-character opaque string
    ("chain_failed_step", "timeout"),  # never a step
    ("chain_diagnostic", "ran"),
    ("chain_diagnostic_failure_class", "ExchangeError: 4321.5"),  # a venue message with an amount
    ("chain_break_kinds", "8.173.SWAP:4321.5"),  # an amount where a count is declared
    ("chain_break_kinds", "8.173.SWAP:1234567"),  # a seven-digit count
    ("chain_break_kinds", "4444444010.1.SPOT:1"),  # a ten-digit bill id as a type code
    ("chain_break_prev_kinds", "8.173.PEPE:1"),  # an instType outside the closed set
    ("chain_break_mgn_modes", "cross:4321.5"),
    ("chain_break_mgn_modes", "margin:1"),  # a mode outside the closed set
    ("chain_residual_bucket", "lt_1e-2"),  # a decade that is not an edge
    ("chain_close_residual_bucket", "zero"),  # no zero bucket exists
    ("chain_sig_other", 0.5),
    ("chain_break_pos_level", True),
]


def test_a_ticker_outside_the_closed_vocabulary_is_other() -> None:
    assert rec._ccy_class("PEPE") == "other"
    assert rec._ccy_class("") == "other"
    assert rec._ccy_class(None) == "none"
    for member in ("USDT", "USDC", "DAI", "BTC", "ETH", "OKB"):
        assert rec._ccy_class(member) == member
    assert all(rec._ccy_class(c) in rec._CCY_CLASSES for c in ("USDT", "PEPE", "BTC", None))


def test_the_arm_is_derived_from_the_two_broken_counts() -> None:
    def _report(interior: int, close: int) -> chain.ChainReport:
        return dataclasses.replace(
            chain.analyse_chain([], {}), ccys_checked=2, ccys_interior_broken=interior, ccys_close_broken=close
        )

    assert [rec.chain_values(_report(i, c))["chain_arm"] for i, c in ((0, 0), (1, 0), (0, 2), (3, 1))] == [
        "none",
        "interior",
        "close",
        "both",
    ]
    assert rec.chain_values(_report(0, 0))["chain_worst_ccy_is_stable"] == FIELD_ABSENT


# ---------------------------------------------------------------------------
# measure_chain: never raises, never overwrites, records a failure by class and step.
# ---------------------------------------------------------------------------


async def test_the_returned_keys_are_a_subset_of_the_chain_keys() -> None:
    """The overwrite guard: a key outside CHAIN_KEYS could silently replace a Phase 172 key when
    the probe merges the dict into its record."""
    ok = await _seeded_values()
    assert set(ok) <= set(rec.CHAIN_KEYS)

    empty = await rec.measure_chain(
        SimpleNamespace(), obal.OkxOpeningReading(None, "chain_break", 0, 0, 0.0, None), {}, OPENING_DAY
    )
    assert set(empty) <= set(rec.CHAIN_KEYS)


async def test_a_venue_error_after_the_walk_is_recorded_by_class_and_keeps_the_analysis() -> None:
    reading_exchange = _exchange(_break_bills(), [_payload("0.9")])
    row = (await obal.read_okx_balance_row(reading_exchange)) or {}
    reading = await obal.read_okx_opening(reading_exchange, None, OPENING_DAY, row)

    async def _refused(params: Any = None) -> Any:
        raise ccxt.AuthenticationError("okx 4321.5 fake-key-id-okx signature=abc123")

    values = await rec.measure_chain(
        SimpleNamespace(private_get_account_balance=_refused), reading, row, OPENING_DAY
    )

    assert values["chain_diagnostic_failure_class"] == "AuthenticationError"
    assert values["chain_failed_step"] == "close"
    assert values["chain_diagnostic"] == "run"  # the analysis ran; only the close read failed
    assert values["chain_arm"] == "both" and values["chain_worst_ccy"] == "USDT"  # earlier keys stay
    assert values["chain_close_matches_after"] == FIELD_ABSENT  # the race was never measured
    assert values["chain_calls"] == 1  # counted before the venue refused
    assert set(values) <= set(rec.CHAIN_KEYS)
    for leak in _SEEDED_LEAKS:
        assert leak not in json.dumps(values), leak


async def test_a_spent_budget_is_a_recorded_ceiling_hit_not_a_crash(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chain, "CHAIN_CALL_CEILING", 0)
    exchange = _exchange(_break_bills(), [_payload("0.9"), _payload("1")])
    row = (await obal.read_okx_balance_row(exchange)) or {}
    reading = await obal.read_okx_opening(exchange, None, OPENING_DAY, row)
    before = exchange.private_get_account_balance.calls

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    # Plan 179-02: a spent budget is the diagnostic stopping itself, recorded as a ceiling hit
    # and not as a venue failure of the close step (plan 179-01 recorded it as step close).
    assert values["chain_ceiling_hit"] is True
    assert values["chain_failed_step"] == "none"
    assert values["chain_close_matches_after"] == FIELD_ABSENT
    assert values["chain_calls"] == 0
    assert exchange.private_get_account_balance.calls == before  # the venue never saw the call


async def test_an_empty_hand_over_is_a_failure_to_see_not_a_clean_reading() -> None:
    values = await rec.measure_chain(
        SimpleNamespace(), obal.OkxOpeningReading(None, "chain_break", 0, 0, 0.0, None), {}, OPENING_DAY
    )

    assert values["chain_diagnostic"] == "failed"
    assert values["chain_diagnostic_failure_class"] == "other"
    assert values["chain_failed_step"] == "analysis"
    assert values["chain_arm"] == FIELD_ABSENT  # nothing was measured


async def test_a_malformed_balance_row_fails_the_analysis_by_class() -> None:
    walked = (okx_bill(1, OPENING_MS, "BTC", "1", "1"),)
    reading = obal.OkxOpeningReading(None, "chain_break", 1, 0, 0.0, None, walked=walked)

    values = await rec.measure_chain(SimpleNamespace(), reading, {"details": "not a list"}, OPENING_DAY)

    assert values["chain_diagnostic"] == "failed"
    assert values["chain_failed_step"] == "analysis"
    assert values["chain_diagnostic_failure_class"] == "malformed_data"  # SFH-179-01: not a diagnostic bug


def test_a_cash_map_is_exact_decimal() -> None:
    # The close compares exact Decimals: 0.1 + 0.2 style float residue must not read as a break.
    report = chain.analyse_chain([okx_bill(1, 1, "BTC", "0.3", "0.3")], {"BTC": Decimal("0.3")})
    assert report.close_broken == frozenset()


# ---------------------------------------------------------------------------
# Residual buckets (mutation N5): exact Decimal edges, strict less-than.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("rel", "bucket"),
    [
        (None, "none"),
        (Decimal("9.99e-13"), "lt_1e-12"),  # just under the first edge
        (Decimal("1e-12"), "lt_1e-9"),  # AT the edge is the next bucket: the comparison is strict
        (Decimal("9.99e-10"), "lt_1e-9"),
        (Decimal("1e-9"), "lt_1e-6"),
        (Decimal("9.99e-7"), "lt_1e-6"),
        (Decimal("1e-6"), "lt_1e-3"),
        (Decimal("9.99e-4"), "lt_1e-3"),
        (Decimal("1e-3"), "lt_1e-1"),
        (Decimal("0.0999"), "lt_1e-1"),
        (Decimal("0.1"), "ge_1e-1"),
        (Decimal("5"), "ge_1e-1"),
    ],
)
def test_the_residual_bucket_edges_are_exact(rel: Decimal | None, bucket: str) -> None:
    """The decade a residual falls in is the finding: a edge that moved one decade would tell the
    founder that dust is a rounding error when it is a missing bill."""
    assert rec._residual_bucket(rel) == bucket
    assert rec.CHAIN_VALIDATORS["chain_residual_bucket"](bucket)
    assert rec.CHAIN_VALIDATORS["chain_close_residual_bucket"](bucket)


# ---------------------------------------------------------------------------
# Kind and margin-mode lists: a closed grammar, ordered, capped.
# ---------------------------------------------------------------------------


def test_kinds_are_ordered_by_count_then_token() -> None:
    kinds = Counter({("8", "173", "SWAP"): 3, ("2", "1", "SPOT"): 1})
    assert rec._kind_token(kinds) == "8.173.SWAP:3,2.1.SPOT:1"

    tie = Counter({("2", "1", "SPOT"): 2, ("1", "1", "SPOT"): 2})
    assert rec._kind_token(tie) == "1.1.SPOT:2,2.1.SPOT:2"
    assert rec._kind_token(Counter()) == "none"


def test_more_than_five_kinds_fold_into_other() -> None:
    kinds = Counter({(str(i), "1", "SPOT"): 8 - i for i in range(1, 8)})  # counts 7, 6, 5, 4, 3, 2, 1

    token = rec._kind_token(kinds)

    assert token == "1.1.SPOT:7,2.1.SPOT:6,3.1.SPOT:5,4.1.SPOT:4,5.1.SPOT:3,other:3"
    assert rec.CHAIN_VALIDATORS["chain_break_kinds"](token)


@pytest.mark.parametrize(
    ("raw", "token"),
    [
        (("", "173", "SWAP"), "x.173.SWAP:1"),  # an empty type is not a code
        (("2", "", "SPOT"), "2.x.SPOT:1"),
        (("12345", "1", "SPOT"), "x.1.SPOT:1"),  # five digits is not a code
        (("a1", "1", "SPOT"), "x.1.SPOT:1"),
        (("2", "1", ""), "2.1.blank:1"),  # a transfer has a blank instType
        (("2", "1", "STRANGE"), "2.1.x:1"),
    ]
    + [(("2", "1", inst), f"2.1.{inst}:1") for inst in ("SPOT", "MARGIN", "SWAP", "FUTURES", "OPTION", "EVENTS")],
)
def test_a_kind_outside_the_closed_grammar_prints_as_x(raw: tuple[str, str, str], token: str) -> None:
    assert rec._kind_token(Counter({raw: 1})) == token
    assert rec.CHAIN_VALIDATORS["chain_break_kinds"](token)


def test_unknown_values_that_print_alike_merge_their_counts() -> None:
    kinds = Counter({("a1", "1", "SPOT"): 2, ("b2", "1", "SPOT"): 3})

    assert rec._kind_token(kinds) == "x.1.SPOT:5"


def test_a_count_is_capped_at_six_digits() -> None:
    token = rec._kind_token(Counter({("2", "1", "SPOT"): 12_345_678}))

    assert token == "2.1.SPOT:999999"
    assert rec.CHAIN_VALIDATORS["chain_break_kinds"](token)


def test_margin_modes_are_a_closed_set_ordered_and_capped() -> None:
    assert rec._mgn_token(Counter({"cross": 2, "isolated": 1, "": 1})) == "cross:2,blank:1,isolated:1"
    assert rec._mgn_token(Counter({"weird": 1})) == "x:1"
    assert rec._mgn_token(Counter({"cash": 1})) == "cash:1"
    assert rec._mgn_token(Counter()) == "none"
    for token in ("cross:2,blank:1,isolated:1", "x:1", "none"):
        assert rec.CHAIN_VALIDATORS["chain_break_mgn_modes"](token)


def test_the_kind_grammar_refuses_what_it_does_not_define() -> None:
    check = rec.CHAIN_VALIDATORS["chain_break_kinds"]
    assert check("none") and check(FIELD_ABSENT)
    for bad in ("", "none,2.1.SPOT:1", "2.1.SPOT:1,", "2.1.SPOT:0.5", "2.1.SPOT", "2.1.SPOT:1,other:1,other:1"):
        assert not check(bad), bad
    assert not check(5) and not check(None)


async def test_the_new_keys_are_measured_values_on_the_seeded_break() -> None:
    values = await _seeded_values()

    assert values["chain_break_kinds"] == "2.x.SPOT:1"  # the empty subType prints as x
    assert values["chain_break_prev_kinds"] == "2.x.SPOT:1"
    assert values["chain_break_mgn_modes"] == "blank:1"
    assert values["chain_break_pos_level"] == 0
    assert values["chain_residual_bucket"] == "lt_1e-3"  # 3 over 61234
    assert values["chain_close_residual_bucket"] == "ge_1e-1"  # 0.1 over 1
    assert (
        values["chain_sig_bal_unchanged"],
        values["chain_sig_double_count"],
        values["chain_sig_reorder"],
        values["chain_sig_other"],
    ) == (0, 0, 0, 1)
    assert len(rec.CHAIN_KEYS) == 59  # plan 179-01's 24 plus Task 1's ten, Task 2's seven, Task 3's sixteen, two refusal counts


# ---------------------------------------------------------------------------
# Plan 179-02 Task 1: the ordering, topology and age keys.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("ms", "bucket"),
    [
        (None, "none"),
        (0, "lt_1h"),
        (3_599_999, "lt_1h"),
        (3_600_000, "lt_1d"),  # AT the edge is the next bucket: the comparison is strict
        (86_399_999, "lt_1d"),
        (86_400_000, "lt_7d"),
        (604_799_999, "lt_7d"),
        (604_800_000, "lt_30d"),
        (2_591_999_999, "lt_30d"),
        (2_592_000_000, "ge_30d"),
        (10**12, "ge_30d"),
    ],
)
def test_the_age_bucket_edges_are_exact(ms: int | None, bucket: str) -> None:
    """The age of the oldest and newest break separates 'a stale migration' from 'today'."""
    assert rec._age_bucket(ms) == bucket
    assert rec.CHAIN_VALIDATORS["chain_first_break_age"](bucket)
    assert rec.CHAIN_VALIDATORS["chain_last_break_age"](bucket)


def test_the_ordering_keys_are_values_of_the_report() -> None:
    world = _tie_values()
    assert world["chain_same_ts_links"] == 1 and world["chain_same_ts_breaks"] == 1
    assert world["chain_closes_by_ts_id"] == 0 and world["chain_closes_by_ts_id_desc"] == 1
    assert world["chain_trail_ccys"] == 1 and world["chain_gap_estimate"] == 0
    assert world["chain_billid_ts_inversions"] == 0
    assert world["chain_first_break_age"] == "lt_1h" and world["chain_last_break_age"] == "lt_1h"
    assert world["chain_breaks_in_recent_7d"] == 3


def _tie_values() -> dict[str, Any]:
    from tests._okx_bills import okx_bills_updated_in_order

    t0 = OPENING_MS + 60_000
    bills = okx_bills_updated_in_order(
        "USDT", "100", ["1", "10", "20", "3"], ids=[1, 3, 2, 4], stamps=[t0, t0 + 5_000, t0 + 5_000, t0 + 6_000]
    )
    return rec.chain_values(chain.analyse_chain(bills, {"USDT": Decimal("134")}))


_BAD_VALUES_TASK_1: list[tuple[str, Any]] = [
    ("chain_first_break_age", "lt_2h"),  # a bucket that is not an edge
    ("chain_last_break_age", "yesterday"),
    ("chain_breaks_in_recent_7d", -1),
    ("chain_trail_ccys", True),
    ("chain_gap_estimate", 1.5),
    ("chain_same_ts_links", "4321.5"),
]


# ---------------------------------------------------------------------------
# Plan 179-02 Task 2: the repeat, balance-clock, below-stop and ceiling groups.
# ---------------------------------------------------------------------------


async def _seeded_exchange_and_reading() -> tuple[SimpleNamespace, Any, obal.OkxOpeningReading]:
    exchange = _exchange(_break_bills(), [_payload("0.9"), _payload("1")])
    row = (await obal.read_okx_balance_row(exchange)) or {}
    reading = await obal.read_okx_opening(exchange, None, OPENING_DAY, row)
    return exchange, row, reading


async def test_a_full_run_records_each_group_and_no_ceiling_hit() -> None:
    exchange, row, reading = await _seeded_exchange_and_reading()

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_ceiling_hit"] is False
    assert values["chain_repeat_reason"] == "chain_break"  # the same archive breaks again: structural
    assert values["chain_below_stop"] == 0 and values["chain_below_stop_complete"] is True
    assert values["chain_failed_step"] == "none"
    # close 1 + second walk (balance 1, archive 1) + below-stop 1 + 7-day 1 + subtypes 1
    # + the sweep's unfiltered page + one type probe + six instType probes
    assert values["chain_calls"] == 4 + 1 + 1 + 1 + 1 + 6
    # The first reading's verdict is the probe's key and is never returned here.
    assert "opening_unavailable_reason" not in values


async def test_a_failure_in_the_repeat_keeps_the_close_keys_and_leaves_below_stop_absent() -> None:
    exchange, row, reading = await _seeded_exchange_and_reading()
    exchange.private_get_account_bills_archive.effect = ccxt.AuthenticationError(
        "okx 4321.5 fake-key-id-okx signature=abc123"
    )

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_failed_step"] == "repeat"
    assert values["chain_diagnostic_failure_class"] == "AuthenticationError"
    assert values["chain_close_matches_after"] == 1  # the close group finished before it
    assert values["chain_repeat_reason"] == "not-run"
    assert values["chain_below_stop"] == FIELD_ABSENT and values["chain_below_stop_complete"] == FIELD_ABSENT
    assert values["chain_ceiling_hit"] == FIELD_ABSENT  # unknown: the run did not finish
    for leak in _SEEDED_LEAKS:
        assert leak not in json.dumps(values), leak


async def test_a_failure_in_the_below_stop_read_is_its_own_step() -> None:
    exchange, row, reading = await _seeded_exchange_and_reading()
    real = exchange.private_get_account_bills_archive

    async def _fails_on_begin(params: dict[str, str]) -> Any:
        if "begin" in params:
            raise ccxt.NetworkError("down")
        return await real(params)

    exchange.private_get_account_bills_archive = _fails_on_begin

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_failed_step"] == "below_stop"
    assert values["chain_repeat_reason"] == "chain_break"  # the earlier group's key stays


async def test_the_ceiling_stops_the_run_between_groups_and_never_changes_a_verdict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A ceiling of 2 is spent by the close read and the second walk's balance read; the second
    walk's first page is refused before the venue sees it."""
    exchange, row, reading = await _seeded_exchange_and_reading()
    monkeypatch.setattr(chain, "CHAIN_CALL_CEILING", 2)
    archive_calls = len(exchange.private_get_account_bills_archive.calls)

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_ceiling_hit"] is True
    assert values["chain_repeat_reason"] == "not-run"  # that group's keys stay at their defaults
    assert values["chain_calls"] == 2
    assert values["chain_failed_step"] == "none"  # a ceiling is not a venue failure
    assert values["chain_arm"] == "both" and values["chain_close_matches_after"] == 1  # earlier keys stay
    assert len(exchange.private_get_account_bills_archive.calls) == archive_calls  # the venue never saw it


_BAD_VALUES_TASK_2: list[tuple[str, Any]] = [
    ("chain_repeat_reason", "unpriced"),  # not one of the oracle's reasons
    ("chain_repeat_reason", "maybe"),
    ("chain_repeat_reason", "4321.5"),
    ("chain_close_bill_after_utime", 1.5),
    ("chain_close_utime_after_bill", -1),
    ("chain_below_stop", True),
    ("chain_below_stop_ccys", "4321.5"),
    ("chain_below_stop_complete", "yes"),
    ("chain_ceiling_hit", 1),
    ("chain_failed_step", "repeat2"),
]


def test_the_repeat_reason_vocabulary_is_the_oracles_closed_set_plus_two() -> None:
    check = rec.CHAIN_VALIDATORS["chain_repeat_reason"]
    for ok in ("not-run", "none", *obal.OPENING_UNAVAILABLE_REASONS):
        assert check(ok), ok
    assert rec.chain_defaults()["chain_repeat_reason"] == "not-run"


# ---------------------------------------------------------------------------
# Plan 179-02 Task 3: the 7-day store and the hidden-kind sweep.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("ms", "bucket"),
    [
        (None, FIELD_ABSENT),  # no 7-day row: not measured, never "none"
        (-1, "none"),
        (0, "none"),
        (1, "lt_1m"),
        (59_999, "lt_1m"),
        (60_000, "lt_10m"),  # AT the edge is the next bucket: the comparison is strict
        (599_999, "lt_10m"),
        (600_000, "lt_1h"),
        (3_599_999, "lt_1h"),
        (3_600_000, "lt_1d"),
        (86_399_999, "lt_1d"),
        (86_400_000, "ge_1d"),
    ],
)
def test_the_archive_lag_bucket_edges_are_exact(ms: int | None, bucket: str) -> None:
    assert rec._lag_bucket(ms) == bucket
    assert rec.CHAIN_VALIDATORS["chain_archive_behind"](bucket)


async def test_a_failure_in_the_seven_day_read_is_its_own_step_and_leaves_the_sweep_absent() -> None:
    exchange, row, reading = await _seeded_exchange_and_reading()
    async def _refused(params: dict[str, str]) -> Any:
        raise ccxt.AuthenticationError("okx 4321.5 fake-key-id-okx signature=abc123")

    exchange.private_get_account_bills = _refused

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_failed_step"] == "recent"
    assert values["chain_diagnostic_failure_class"] == "AuthenticationError"
    assert values["chain_below_stop_complete"] is True  # the earlier groups stay
    assert values["chain_recent_read"] == FIELD_ABSENT and values["chain_types_probed"] == FIELD_ABSENT
    for leak in _SEEDED_LEAKS:
        assert leak not in json.dumps(values), leak


async def test_a_failure_in_the_subtypes_read_is_the_sweep_step() -> None:
    exchange, row, reading = await _seeded_exchange_and_reading()

    async def _refused(params: dict[str, str]) -> Any:
        raise ccxt.NetworkError("down")

    exchange.private_get_account_subtypes = _refused

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_failed_step"] == "sweep"
    assert values["chain_recent_complete"] is True  # the 7-day group finished
    assert values["chain_sweep_complete"] == FIELD_ABSENT


async def test_a_subtypes_reply_listing_no_type_is_not_a_complete_sweep() -> None:
    """Review CR-01: the record prints ``chain_types_probed=0`` and must not print
    ``chain_sweep_complete=True`` beside it, or plan 179-03 reads "no hidden type" as proven."""
    exchange, row, reading = await _seeded_exchange_and_reading()

    async def _empty(params: dict[str, str]) -> Any:
        return {"code": "0", "data": []}

    exchange.private_get_account_subtypes = _empty

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_types_probed"] == 0
    assert values["chain_inst_types_probed"] == len(chain.SWEEP_INST_TYPES)
    assert values["chain_sweep_complete"] is False


async def test_a_refused_sweep_filter_is_not_a_failed_step_and_keeps_the_other_probes() -> None:
    """Review WR-03, SFH-179-02: a venue that refuses the EVENTS instType must not cost the
    type probes. The sweep keys stay measured, and ``chain_sweep_complete`` says it was cut."""
    exchange, row, reading = await _seeded_exchange_and_reading()
    walk_archive = exchange.private_get_account_bills_archive

    async def _refuses_events(params: dict[str, str]) -> Any:
        if params.get("instType") == "EVENTS":
            raise ccxt.BadRequest("okx refused the filter")
        return await walk_archive(params)

    exchange.private_get_account_bills_archive = _refuses_events

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_failed_step"] == "none"
    assert values["chain_types_probed"] == 1
    assert values["chain_inst_types_probed"] == len(chain.SWEEP_INST_TYPES) - 1
    assert values["chain_sweep_complete"] is False
    assert values["chain_ceiling_hit"] is False
    # Review WR-03, SFH-R2-04: a refusal that repeats on every run must be visible as a count, not
    # look like an unexplained incomplete search (the recent group, which ran clean, says 0).
    assert values["chain_sweep_refused"] == 1
    assert values["chain_recent_refused"] == 0


async def test_a_refused_seven_day_page_keeps_the_rows_and_is_not_a_failed_step() -> None:
    exchange, row, reading = await _seeded_exchange_and_reading()
    store = OkxBillsArchive([okx_bill(i, OPENING_MS + i, "USDT", "1", "1") for i in range(1, 151)])

    async def _refuses_page_two(params: dict[str, str]) -> Any:
        if "after" in params:
            raise ccxt.BadRequest("okx refused the page")
        return await store(params)

    exchange.private_get_account_bills = _refuses_page_two

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_failed_step"] == "none"
    assert values["chain_recent_read"] == 100
    assert values["chain_recent_complete"] is False
    assert values["chain_sweep_complete"] is True  # the later group still ran
    assert values["chain_recent_refused"] == 1
    assert values["chain_sweep_refused"] == 0


async def test_a_hidden_bill_newer_than_every_walked_bill_is_not_read_as_no_hidden_kind() -> None:
    """Review WR-01 at the record: the hidden type-34 bill sits above the newest walked bill (a
    close-only break), and was stamped before the walk began. The record must name it."""
    rows = [dict(r) for r in _break_bills().rows]
    hidden = okx_bill(4444444020, OPENING_MS + 9_500_000, "USDT", "20001", "1", bill_type="34")
    archive = OkxBillsArchive([*rows, hidden], hide_type=frozenset({"34"}))
    exchange = _exchange(archive, [_payload("0.9"), _payload("1")])
    row = (await obal.read_okx_balance_row(exchange)) or {}
    reading = await obal.read_okx_opening(exchange, None, OPENING_DAY, row)

    async def _subtypes(params: dict[str, str]) -> Any:
        return okx_subtypes_payload({"2": ["1"], "34": ["1"]})

    exchange.private_get_account_subtypes = _subtypes

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY, OPENING_MS + 10_000_000)

    assert values["chain_types_hidden"] == 1
    assert values["chain_hidden_kinds"] == "34.x.SPOT:1"


_OVERLAP_KEYS = (
    "chain_recent_both",
    "chain_recent_only_bills",
    "chain_recent_after_walk",
    "chain_recent_only_archive",
    "chain_recent_field_mismatch",
    "chain_recent_only_bills_kinds",
)


async def test_an_empty_seven_day_store_prints_no_overlap_count() -> None:
    """Review SFH-179-04: with nothing to compare, ``chain_recent_only_archive=0`` would read as
    "the archive lags nothing". Not measured is field-absent, never 0."""
    exchange, row, reading = await _seeded_exchange_and_reading()  # the 7-day store is empty

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_recent_read"] == 0 and values["chain_recent_complete"] is True
    for key in _OVERLAP_KEYS:
        assert values[key] == FIELD_ABSENT, key


async def test_a_seven_day_read_cut_before_its_first_row_prints_no_overlap_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Close 1, second walk 2 and below-stop 1 are four calls; a ceiling of four refuses the
    first 7-day page."""
    exchange, row, reading = await _seeded_exchange_and_reading()
    monkeypatch.setattr(chain, "CHAIN_CALL_CEILING", 4)

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_ceiling_hit"] is True
    assert values["chain_recent_read"] == 0 and values["chain_recent_complete"] is False
    for key in _OVERLAP_KEYS:
        assert values[key] == FIELD_ABSENT, key


async def test_a_cut_seven_day_read_keeps_a_positive_count_and_drops_the_zeros() -> None:
    """A positive count from a cut read is a lower bound and stays; a zero from it proves
    nothing and is field-absent."""
    exchange, row, reading = await _seeded_exchange_and_reading()
    # Ids below the walk's largest, stamped inside the window, absent from the walk: real
    # absences. The page ceiling cuts the read.
    exchange.private_get_account_bills = OkxBillsArchive(
        [okx_bill(i, OPENING_MS + i, "USDT", "1", "1") for i in range(1, 1_051)]
    )

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_recent_complete"] is False
    assert isinstance(values["chain_recent_only_bills"], int) and values["chain_recent_only_bills"] > 0
    assert values["chain_recent_after_walk"] == FIELD_ABSENT
    assert values["chain_recent_both"] == FIELD_ABSENT


async def test_a_full_below_stop_page_with_no_bill_below_the_stop_prints_no_zero() -> None:
    """Review SFH-179-04: a full page is a presence check, so ``chain_below_stop=0`` beside
    ``chain_below_stop_complete=false`` is not a measured zero."""
    exchange, row, reading = await _seeded_exchange_and_reading()
    walk_archive = exchange.private_get_account_bills_archive

    async def _full_page_above_the_stop(params: dict[str, str]) -> Any:
        if "begin" in params and "after" in params:  # only the below-stop read sends both
            return {
                "code": "0",
                "data": [okx_bill(9_000_000_000 + i, OPENING_MS + 1_000, "USDT", "1", "1") for i in range(100)],
            }
        return await walk_archive(params)

    exchange.private_get_account_bills_archive = _full_page_above_the_stop

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_below_stop_complete"] is False
    assert values["chain_below_stop"] == FIELD_ABSENT
    assert values["chain_below_stop_ccys"] == FIELD_ABSENT


async def test_a_sweep_that_hits_the_ceiling_records_what_it_read_and_says_so(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Close 1, second walk 2, below-stop 1, 7-day 1 and subtypes 1 are six calls, and the sweep's
    unfiltered page a seventh; a ceiling of nine lets the type probe and the SPOT probe through and
    refuses the third."""
    exchange, row, reading = await _seeded_exchange_and_reading()
    monkeypatch.setattr(chain, "CHAIN_CALL_CEILING", 9)

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_ceiling_hit"] is True
    assert values["chain_sweep_complete"] is False
    assert (values["chain_types_probed"], values["chain_inst_types_probed"]) == (1, 1)
    assert values["chain_calls"] == 9
    assert values["chain_failed_step"] == "none"


async def test_a_seven_day_ceiling_records_the_partial_read() -> None:
    exchange, row, reading = await _seeded_exchange_and_reading()
    # A 7-day store of 1000 bills pages ten times; the call ceiling is far above that, so the
    # PAGE ceiling ends it incomplete and nothing else about the run changes.
    exchange.private_get_account_bills = OkxBillsArchive(
        [okx_bill(i, OPENING_MS + i, "USDT", "1", "1") for i in range(1, 1_051)]
    )

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_recent_read"] == chain.RECENT_PAGE_CEILING * 100
    assert values["chain_recent_complete"] is False
    assert values["chain_ceiling_hit"] is False
    assert values["chain_sweep_complete"] is True


_BAD_VALUES_TASK_3: list[tuple[str, Any]] = [
    ("chain_recent_read", 1.5),
    ("chain_recent_complete", "yes"),
    ("chain_recent_both", -1),
    ("chain_recent_only_bills", True),
    ("chain_recent_after_walk", "4321.5"),
    ("chain_recent_only_archive", 0.5),
    ("chain_recent_field_mismatch", None),
    ("chain_recent_only_bills_kinds", "8.173.SWAP:4321.5"),
    ("chain_recent_only_bills_kinds", "4444444010.1.SPOT:1"),
    ("chain_archive_behind", "lt_2m"),
    ("chain_archive_behind", 1800000),
    ("chain_types_probed", "maybe"),
    ("chain_types_hidden", -2),
    ("chain_inst_types_probed", 2.5),
    ("chain_inst_types_hidden", False),
    ("chain_hidden_kinds", "34.x.PEPE:1"),
    ("chain_hidden_kinds", "none,none"),
    ("chain_sweep_partial", "unpriced"),
    ("chain_sweep_complete", 0),
    ("chain_recent_refused", -1),
    ("chain_sweep_refused", True),
]


async def test_the_balance_clock_keys_are_measured_from_the_pre_walk_row() -> None:
    """Both directions at once, on the pre-walk row passed to ``measure_chain``: USDT's clock is
    after its newest bill and BTC's before its newest bill. A row with no clock leaves both keys
    field-absent (not measured), never 0."""
    exchange, row, reading = await _seeded_exchange_and_reading()
    clocked = {
        **row,
        "details": [
            {**row["details"][0], "uTime": str(OPENING_MS + 9_000_000 + 1)},  # USDT, newest bill at +9000000
            {**row["details"][1], "uTime": str(OPENING_MS + 7_200_000 - 1)},  # BTC, newest bill at +7200000
        ],
    }

    with_clocks = await rec.measure_chain(exchange, reading, clocked, OPENING_DAY)
    without = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert (with_clocks["chain_close_bill_after_utime"], with_clocks["chain_close_utime_after_bill"]) == (1, 1)
    assert without["chain_close_bill_after_utime"] == FIELD_ABSENT
    assert without["chain_close_utime_after_bill"] == FIELD_ABSENT


# ---------------------------------------------------------------------------
# Fix round 1 (topic B): a malformed row is its own class, not a diagnostic bug.
# ---------------------------------------------------------------------------


async def test_a_malformed_row_in_one_group_is_its_own_class_and_does_not_stop_the_later_groups() -> None:
    # Why: ``OpeningUnavailable`` is about the DATA OKX served, not a venue fault, so the groups
    # after it are independent and must still run (SFH-179-01). It must also read differently from
    # a defect in the diagnostic, which is class ``other``: on the single PROD run the founder has
    # to tell "OKX served a malformed bill" from "the diagnostic has a bug".
    exchange, row, reading = await _seeded_exchange_and_reading()
    real = exchange.private_get_account_bills_archive
    served = {"malformed": False}

    async def _malformed_once_on_begin(params: dict[str, str]) -> Any:
        if "begin" in params and not served["malformed"]:
            served["malformed"] = True
            return {"data": "not a list"}
        return await real(params)

    exchange.private_get_account_bills_archive = _malformed_once_on_begin

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_failed_step"] == "below_stop"
    assert values["chain_diagnostic_failure_class"] == "malformed_data"
    assert values["chain_diagnostic_failure_class"] != "other"
    assert rec.CHAIN_VALIDATORS["chain_diagnostic_failure_class"]("malformed_data")
    assert values["chain_below_stop"] == FIELD_ABSENT  # the group that met the row measured nothing
    assert values["chain_recent_complete"] is True  # the later groups ran
    assert values["chain_types_probed"] == 1
    # Plan 179-03 reads False as "every group ran". A group failed, so the ceiling is not measured.
    assert values["chain_ceiling_hit"] == FIELD_ABSENT


async def test_a_malformed_balance_in_the_close_group_is_not_a_complete_search() -> None:
    # Why (review CR-01, SFH-R2-02): the close group has no ``*_complete`` key, so its failure is
    # visible to plan 179-03 only through ``chain_ceiling_hit``. A measured False there reads as
    # "every group ran" and lets named-refusal be recommended while the cash-after race measured
    # nothing. The later groups still run (their own keys stay), the ceiling stays unmeasured.
    exchange, row, reading = await _seeded_exchange_and_reading()
    exchange.private_get_account_balance = OkxBalanceSequence([{"data": "not a list"}, _payload("1")])

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_failed_step"] == "close"
    assert values["chain_diagnostic_failure_class"] == "malformed_data"
    assert values["chain_close_cash_moved"] == FIELD_ABSENT and values["chain_close_matches_after"] == FIELD_ABSENT
    assert values["chain_recent_complete"] is True  # the later groups ran
    assert values["chain_ceiling_hit"] == FIELD_ABSENT


async def test_the_failure_that_stops_the_run_is_the_one_recorded_not_an_earlier_malformed_one() -> None:
    # Why (review WR-01, SFH-R2-03): a malformed row lets the run continue, so a later venue fault
    # can be the one that stops it. The founder reads ``chain_failed_step`` / the class to decide
    # whether a second run can help: "OKX served a malformed row" may repeat, a network fault may not.
    exchange, row, reading = await _seeded_exchange_and_reading()
    real = exchange.private_get_account_bills_archive
    served = {"malformed": False}

    async def _malformed_once_on_begin(params: dict[str, str]) -> Any:
        if "begin" in params and not served["malformed"]:
            served["malformed"] = True
            return {"data": "not a list"}
        return await real(params)

    async def _network_down(params: dict[str, str]) -> Any:
        raise ccxt.NetworkError("down")

    exchange.private_get_account_bills_archive = _malformed_once_on_begin
    exchange.private_get_account_bills = _network_down

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_failed_step"] == "recent"
    assert values["chain_diagnostic_failure_class"] == "NetworkError"
    assert values["chain_below_stop"] == FIELD_ABSENT  # the earlier malformed group stays visible as absent keys
    assert values["chain_types_probed"] == FIELD_ABSENT  # and the run stopped at the fault
    assert values["chain_ceiling_hit"] == FIELD_ABSENT


async def test_a_venue_fault_after_a_diverged_refold_does_not_overwrite_the_divergence() -> None:
    # Why (review round 3 WR-02): ``diverged`` pre-sets the step to analysis, a defect a second run
    # will not clear. A venue fault that then stops the run must not overwrite it, or the founder's
    # sc1 line blames a transient fault for it. The stop still shows: the later keys are field-absent.
    walked = (
        okx_bill(4444444001, OPENING_MS + 3_600_000, "USDT", "20000", "5"),
        okx_bill(4444444002, OPENING_MS + 7_200_000, "BTC", "1", "1"),
    )
    reading = obal.OkxOpeningReading(None, "chain_break", 2, 0, 0.0, None, walked=walked)
    exchange = _exchange(OkxBillsArchive(list(walked)), [_payload("1"), _payload("1")])
    row = (await obal.read_okx_balance_row(exchange)) or {}

    async def _network_down(params: dict[str, str]) -> Any:
        raise ccxt.NetworkError("down")

    exchange.private_get_account_bills = _network_down

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_arm"] == "diverged"
    assert values["chain_failed_step"] == "analysis"
    assert values["chain_diagnostic_failure_class"] == "other"
    assert values["chain_ceiling_hit"] == FIELD_ABSENT


async def test_a_refold_that_holds_beside_a_chain_break_refusal_is_not_a_clean_chain() -> None:
    # Why: ``measure_chain`` runs only after the oracle refused with ``chain_break``. If the
    # re-fold of the same bills finds no broken link and no broken close, the two disagree (SFH-179-05),
    # and ``chain_arm=none`` beside ``chain_diagnostic=run`` would read as a clean chain next to a
    # refusal. The disagreement must be visible, not ``none``, and the counts stay.
    walked = (
        okx_bill(4444444001, OPENING_MS + 3_600_000, "USDT", "20000", "5"),
        okx_bill(4444444002, OPENING_MS + 7_200_000, "BTC", "1", "1"),
    )
    reading = obal.OkxOpeningReading(None, "chain_break", 2, 0, 0.0, None, walked=walked)
    exchange = _exchange(OkxBillsArchive(list(walked)), [_payload("1"), _payload("1")])
    row = (await obal.read_okx_balance_row(exchange)) or {}

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_arm"] == "diverged"
    assert values["chain_arm"] != "none"
    assert values["chain_diagnostic"] == "failed"
    assert values["chain_failed_step"] == "analysis"
    assert values["chain_ccys_checked"] == 2  # the counts stay beside the flag
    assert values["chain_ccys_interior_broken"] == 0 and values["chain_ccys_close_broken"] == 0
    assert rec.CHAIN_VALIDATORS["chain_arm"]("diverged")


async def test_a_group_that_outlives_the_chain_deadline_is_a_recorded_timeout_and_keeps_earlier_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Why: the chain tail runs inside the probe's one crawl bound; a hang there must end by its OWN
    # deadline, as a recorded Timeout at the step it happened in, so the caller keeps the first
    # reading (SFH-179-06). The groups before it stay measured.
    exchange, row, reading = await _seeded_exchange_and_reading()

    async def _hangs(*args: Any, **kwargs: Any) -> Any:
        await asyncio.sleep(5)

    monkeypatch.setattr(rec, "CHAIN_TIMEOUT_S", 0.05, raising=False)
    monkeypatch.setattr(chain, "read_below_stop", _hangs)

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_diagnostic_failure_class"] == "Timeout"
    assert values["chain_failed_step"] == "below_stop"
    assert values["chain_close_matches_after"] == 1 and values["chain_repeat_reason"] == "chain_break"
    assert values["chain_recent_read"] == FIELD_ABSENT  # nothing after the timeout ran


async def test_the_callers_remaining_budget_shortens_the_chain_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Why (review WR-04): the caller's outer bound may have less than CHAIN_TIMEOUT_S left; the chain
    # must stop by the smaller one, as a recorded Timeout, or the outer bound cancels the reading.
    exchange, row, reading = await _seeded_exchange_and_reading()

    async def _hangs(*args: Any, **kwargs: Any) -> Any:
        await asyncio.sleep(5)

    monkeypatch.setattr(chain, "read_below_stop", _hangs)

    values = await asyncio.wait_for(
        rec.measure_chain(exchange, reading, row, OPENING_DAY, budget_s=0.05), 2.0
    )  # the default 300 s would outlast this wait

    assert values["chain_diagnostic_failure_class"] == "Timeout"
    assert values["chain_failed_step"] == "below_stop"


async def test_a_defect_in_the_report_to_record_step_is_a_failed_analysis_not_a_raise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Why: ``measure_chain`` promises never to raise; ``chain_values`` ran outside the try (SFH-179-06).
    exchange, row, reading = await _seeded_exchange_and_reading()

    def _defect(report: Any) -> dict[str, Any]:
        raise KeyError("secret-amount-4321.5")

    monkeypatch.setattr(rec, "chain_values", _defect)

    values = await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    assert values["chain_diagnostic"] == "failed"
    assert values["chain_failed_step"] == "analysis"
    assert values["chain_diagnostic_failure_class"] == "other"
    assert "4321.5" not in json.dumps(values)


async def test_a_failed_step_leaves_a_log_line_naming_the_class_and_step_and_never_the_message(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # Why (SFH-179-07): the diagnostic is read once on PROD; a defect in it must leave a trace that
    # names what failed and where, or it costs a whole approval cycle to find. The venue message may
    # carry an amount or an id, so only the exception CLASS and the step may be logged.
    exchange, row, reading = await _seeded_exchange_and_reading()

    async def _defect(params: dict[str, str]) -> Any:
        raise KeyError("secret-amount-4321.5 fake-key-id-okx")

    exchange.private_get_account_bills = _defect

    with caplog.at_level("WARNING", logger=rec.__name__):
        await rec.measure_chain(exchange, reading, row, OPENING_DAY)

    logged = " ".join(record.getMessage() for record in caplog.records if record.name == rec.__name__)
    assert "KeyError" in logged and "recent" in logged
    assert "4321.5" not in logged and "fake-key-id-okx" not in logged
    assert not any(record.exc_info for record in caplog.records)  # a traceback would print the message


async def test_a_failed_analysis_leaves_a_log_line_naming_the_class_and_step(
    caplog: pytest.LogCaptureFixture,
) -> None:
    walked = (okx_bill(1, OPENING_MS, "BTC", "1", "1"),)
    reading = obal.OkxOpeningReading(None, "chain_break", 1, 0, 0.0, None, walked=walked)

    with caplog.at_level("WARNING", logger=rec.__name__):
        await rec.measure_chain(SimpleNamespace(), reading, {"details": "not a list"}, OPENING_DAY)

    logged = " ".join(record.getMessage() for record in caplog.records if record.name == rec.__name__)
    assert "OpeningUnavailable" in logged and "analysis" in logged
