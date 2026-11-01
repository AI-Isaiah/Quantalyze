"""Phase 180 BYBITFUNDING plan 01 - tests for ``scripts/bybit_funding_record.py``.

The probe names how a Bybit account was funded from five read-only GETs and the key's own flags.
The founder reads those counts at SC-3 and decides whether a6's history is rebuilt, so the thing to
get right is the difference between "this source holds nothing" and "this source could not be read":

  * a count is printed only for windows the venue ANSWERED, and a source that failed prints a closed
    state token with field-absent counts, never a 0 (D-03);
  * each source asks the question its own endpoint documents (its window rule, its success
    statuses), because a source read with the wrong window or counted with the wrong statuses
    returns a confident wrong number;
  * a master-only source is not called for a sub key, and the key's flags are booleans read
    strictly, never an id.

The double (``tests/_bybit_evidence.py``) answers the way Bybit v5 does, including the span rules
that make a mis-windowed request fail, so these tests drive the real reader against it.
"""
from __future__ import annotations

import asyncio
import re
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import ccxt.async_support as ccxt
import pytest

import scripts.bybit_funding_record as rec
from tests._bybit_evidence import DAY_MS, METHODS, EvidenceBook

RUN_DAY = date(2026, 10, 23)
NOW_MS = rec._day_ms(RUN_DAY) + 12 * 60 * 60 * 1000
SINCE_MS = rec._day_ms(RUN_DAY - timedelta(days=729))
SOURCE_NAMES = [source.name for source in rec.EVIDENCE_SOURCES]


def _client(book: EvidenceBook, monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(rec, "_now_ms", lambda: NOW_MS)
    client = SimpleNamespace()
    book.attach(client)
    return client


def _ago(days: float) -> int:
    return NOW_MS - int(days * DAY_MS)


# name -> (statuses that are a success (one row each), statuses that are not, the id of the window rule)
_STATUSES: dict[str, tuple[list[Any], list[Any]]] = {
    "onchain_dep": (["3", "10012", "70012"], ["4", "1"]),
    "internal_dep": ([2], [1, 3]),  # Bybit sends this status as a number
    "withdraw_all": (["success", "BlockchainConfirmed"], ["Pending", "Fail"]),
    "inter_xfer": (["SUCCESS", "SUCCESS", "SUCCESS"], ["PENDING", "FAILED"]),
    "universal_xfer": (["SUCCESS", "SUCCESS", "SUCCESS"], ["PENDING", "FAILED"]),
}
_RAW_METHOD = {
    "onchain_dep": "private_get_v5_asset_deposit_query_record",
    "internal_dep": "private_get_v5_asset_deposit_query_internal_record",
    "withdraw_all": "private_get_v5_asset_withdraw_query_record",
    "inter_xfer": "private_get_v5_asset_transfer_query_inter_transfer_list",
    "universal_xfer": "private_get_v5_asset_transfer_query_universal_transfer_list",
}
_SPAN_LIMIT_MS = {
    "onchain_dep": 30 * DAY_MS,
    "internal_dep": 30 * DAY_MS,
    "withdraw_all": 30 * DAY_MS,
    "inter_xfer": 7 * DAY_MS,
    "universal_xfer": 7 * DAY_MS,
}


def test_the_five_sources_are_the_ones_the_docs_name_in_order() -> None:
    assert SOURCE_NAMES == ["onchain_dep", "internal_dep", "withdraw_all", "inter_xfer", "universal_xfer"]
    assert rec.FUNDING_KEYS[:3] == ("bybit_key_info_state", "bybit_is_master", "bybit_is_uta")
    assert {source.name: source.method for source in rec.EVIDENCE_SOURCES} == _RAW_METHOD
    assert set(rec.INFLOW_SOURCE_NAMES) == set(SOURCE_NAMES) - {"withdraw_all"}


@pytest.mark.parametrize("name", SOURCE_NAMES)
async def test_each_evidence_source_reads_its_own_endpoint_window_and_success_status(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A source counts only the statuses its endpoint documents as a success; every other status is
    # visible as a count of its own, so a wrong success set shows in the record instead of hiding.
    success, other = _STATUSES[name]
    book = EvidenceBook()
    for index, status in enumerate(success):
        book.add(name, _ago(10 + index), status, rid=f"fake-transfer-ok-{index}")
    book.add(name, _ago(400), success[0], rid="fake-transfer-old")  # a success older than a year
    for index, status in enumerate(other):
        book.add(name, _ago(5 + index), status, rid=f"fake-transfer-other-{index}")
    client = _client(book, monkeypatch)

    out = await rec.measure_funding(client, SINCE_MS, RUN_DAY)

    assert out[f"bybit_{name}_rows"] == len(success) + 1
    assert out[f"bybit_{name}_older_365d"] == 1
    assert out[f"bybit_{name}_oldest_age_bucket"] == "365-546"
    assert out[f"bybit_{name}_other_status_rows"] == len(other)
    assert out[f"bybit_{name}_depth_bucket"] == "547-729"
    assert out[f"bybit_{name}_state"] == "read"
    # Each source asked its own endpoint, under that endpoint's span rule, with both bounds as strings.
    for source_name, method in _RAW_METHOD.items():
        calls = book.calls_to(source_name)
        assert calls, f"{source_name} never called {method}"
        for params in calls:
            assert int(params["endTime"]) - int(params["startTime"]) <= _SPAN_LIMIT_MS[source_name]
            assert isinstance(params["startTime"], str) and isinstance(params["endTime"], str)
            assert params["limit"] == "50"
        # No other source's rows leaked into this one: the others hold nothing and read as 0.
        if source_name != name:
            assert out[f"bybit_{source_name}_rows"] == 0
            assert out[f"bybit_{source_name}_state"] == "read"
    if name == "withdraw_all":
        assert all(params["withdrawType"] == "2" for params in book.calls_to(name))
    else:
        assert all("withdrawType" not in params for params in book.calls_to(name))


@pytest.mark.parametrize(
    ("result", "master", "uta", "state"),
    [
        ({"isMaster": True, "uta": 1}, True, True, "read"),
        ({"isMaster": False, "uta": 0}, False, False, "read"),
        # Strict: a string or a number is not a boolean, and a boolean is not a UTA flag.
        ({"isMaster": "true", "uta": "1"}, rec.FIELD_ABSENT, rec.FIELD_ABSENT, "read"),
        ({"isMaster": 1, "uta": True}, rec.FIELD_ABSENT, rec.FIELD_ABSENT, "read"),
        ({"isMaster": None, "uta": 2}, rec.FIELD_ABSENT, rec.FIELD_ABSENT, "read"),
        ({"userID": "fake-userid-777", "parentUid": "fake-parentuid-888"}, rec.FIELD_ABSENT, rec.FIELD_ABSENT, "read"),
        ("not-a-dict", rec.FIELD_ABSENT, rec.FIELD_ABSENT, "malformed"),
    ],
)
async def test_the_key_info_is_read_strictly_and_never_keeps_an_id(
    result: Any, master: Any, uta: Any, state: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    book = EvidenceBook()
    book.key_info = result
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert (out["bybit_key_info_state"], out["bybit_is_master"], out["bybit_is_uta"]) == (state, master, uta)
    assert set(out) == set(rec.FUNDING_KEYS)  # only the declared keys, so no id can ride along
    assert "fake-userid" not in repr(out) and "fake-parentuid" not in repr(out)


@pytest.mark.parametrize(
    ("effect", "state"),
    [
        ("malformed", "malformed"),
        (ccxt.PermissionDenied("fake refusal"), "PermissionDenied"),
        (ccxt.NetworkError("fake outage"), "NetworkError"),
    ],
)
async def test_a_key_info_that_cannot_be_read_is_a_state_and_the_sources_still_run(
    effect: Any, state: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    book = EvidenceBook()
    book.effects["private_get_v5_user_query_api"] = [effect]
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_key_info_state"] == state
    assert (out["bybit_is_master"], out["bybit_is_uta"]) == (rec.FIELD_ABSENT, rec.FIELD_ABSENT)
    # The flag is unknown, so the master-only source is still tried: its refusal would be its own state.
    assert book.calls_to("withdraw_all")
    assert out["bybit_withdraw_all_state"] == "read"


async def test_a_master_only_source_is_not_called_for_a_sub_key(monkeypatch: pytest.MonkeyPatch) -> None:
    # The withdrawal record answers "the master UID's api key only": for a sub key it is not called,
    # and it prints its own state with field-absent counts, not a 0 that reads as "never withdrew".
    book = EvidenceBook()
    book.add("withdraw_all", _ago(10), "success", rid="fake-transfer-w1")
    book.key_info = {"isMaster": False, "uta": 1}
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert book.calls_to("withdraw_all") == []
    assert out["bybit_withdraw_all_state"] == "not-master"
    for suffix in ("rows", "older_365d", "oldest_age_bucket", "other_status_rows", "depth_bucket"):
        assert out[f"bybit_withdraw_all_{suffix}"] == rec.FIELD_ABSENT
    # The sources a sub key CAN read are still read.
    assert book.calls_to("onchain_dep") and out["bybit_onchain_dep_state"] == "read"

    # A master key, and a key whose flag could not be read, both call it.
    for key_info in ({"isMaster": True, "uta": 1}, {"uta": 1}):
        book = EvidenceBook()
        book.add("withdraw_all", _ago(10), "success", rid="fake-transfer-w1")
        book.key_info = key_info
        out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
        assert book.calls_to("withdraw_all")
        assert (out["bybit_withdraw_all_state"], out["bybit_withdraw_all_rows"]) == ("read", 1)


async def test_a_source_the_key_cannot_read_is_a_state_never_a_count(monkeypatch: pytest.MonkeyPatch) -> None:
    # (a) refused on the very first call: a closed class, nothing counted, no depth.
    book = EvidenceBook()
    book.add("internal_dep", _ago(10), 2, rid="fake-transfer-i1")
    book.effects["private_get_v5_asset_deposit_query_internal_record"] = [ccxt.PermissionDenied("fake")]
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_internal_dep_state"] == "PermissionDenied"
    for suffix in ("rows", "older_365d", "oldest_age_bucket", "other_status_rows", "depth_bucket"):
        assert out[f"bybit_internal_dep_{suffix}"] == rec.FIELD_ABSENT, suffix
    # The next source still ran, and a source that answered and holds nothing reads 0 (not absent).
    assert (out["bybit_withdraw_all_state"], out["bybit_withdraw_all_rows"]) == ("read", 0)

    # (b) refused on the third window: the two windows already read keep their rows, and the depth
    # bucket says how far back the source answered.
    book = EvidenceBook()
    book.add("onchain_dep", _ago(10), "3", rid="fake-transfer-a")
    book.add("onchain_dep", _ago(40), "3", rid="fake-transfer-b")
    book.add("onchain_dep", _ago(70), "3", rid="fake-transfer-c")  # in the window that is refused
    book.effects["private_get_v5_asset_deposit_query_record"] = [None, None, ccxt.PermissionDenied("fake")]
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_onchain_dep_state"] == "PermissionDenied"
    assert out["bybit_onchain_dep_rows"] == 2
    assert out["bybit_onchain_dep_depth_bucket"] == "30-89"  # the second window starts ~57 days back
    assert len(book.calls_to("onchain_dep")) == 3  # it stopped at its first failure

    # (c) a source that runs out of time is the state Timeout, and the next source still runs.
    monkeypatch.setattr(rec, "EVIDENCE_SOURCE_TIMEOUT_S", 0.05)
    book = EvidenceBook()
    book.add("internal_dep", _ago(10), 2, rid="fake-transfer-i1")
    book.effects["private_get_v5_asset_deposit_query_record"] = ["hang"]
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_onchain_dep_state"] == "Timeout"
    assert out["bybit_onchain_dep_rows"] == rec.FIELD_ABSENT
    assert (out["bybit_internal_dep_state"], out["bybit_internal_dep_rows"]) == ("read", 1)


@pytest.mark.parametrize(
    "answer",
    [
        "not-a-dict",
        {"retCode": 0, "result": "not-a-dict"},
        {"retCode": 0, "result": {"rows": "not-a-list"}},
        {"retCode": 0, "result": {"rows": ["not-a-dict"]}},
        # SFH M-7: a cursor of the wrong type is a refused answer (the Unified reader refuses the
        # same), never "no more pages" with the state still "read".
        {"retCode": 0, "result": {"rows": [], "nextPageCursor": 7}},
        {"retCode": 0, "result": {"rows": [], "nextPageCursor": {"next": "fake-cursor"}}},
    ],
)
async def test_a_malformed_page_is_named_and_counts_nothing(answer: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    async def _answer(_params: dict[str, Any]) -> Any:
        return answer

    client = _client(EvidenceBook(), monkeypatch)
    client.private_get_v5_asset_deposit_query_record = _answer
    out = await rec.measure_funding(client, SINCE_MS, RUN_DAY)
    assert out["bybit_onchain_dep_state"] == "malformed"
    assert out["bybit_onchain_dep_rows"] == rec.FIELD_ABSENT
    assert out["bybit_internal_dep_state"] == "read"


async def test_a_success_row_without_a_readable_stamp_is_malformed_never_invented(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    book = EvidenceBook()
    book.add("onchain_dep", _ago(10), "3", rid="fake-transfer-a", successAt="not-a-stamp")
    book.add("onchain_dep", _ago(11), "3", rid="fake-transfer-b")
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_onchain_dep_state"] == "malformed"
    assert out["bybit_onchain_dep_rows"] == rec.FIELD_ABSENT


async def test_a_malformed_page_or_a_page_cap_is_named(monkeypatch: pytest.MonkeyPatch) -> None:
    # A walk that would need more pages than the cap allows says so, whether more rows really
    # remain or the venue keeps answering the same cursor; neither reads as a short count.
    book = EvidenceBook()
    book.effects["private_get_v5_asset_deposit_query_record"] = ["malformed"]
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_onchain_dep_state"] == "malformed"
    assert out["bybit_onchain_dep_rows"] == rec.FIELD_ABSENT

    monkeypatch.setattr(rec, "EVIDENCE_PAGE_CAP", 3)
    book = EvidenceBook()
    for index in range(160):  # four pages of 50 inside the newest window
        book.add("onchain_dep", _ago(1) - index, "3", rid=f"fake-transfer-{index}")
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_onchain_dep_state"] == "ceiling"
    assert out["bybit_onchain_dep_rows"] == rec.FIELD_ABSENT  # no window was answered in full

    book = EvidenceBook()
    book.add("internal_dep", _ago(1), 2, rid="fake-transfer-a")
    book.effects["private_get_v5_asset_deposit_query_internal_record"] = ["repeat"] * 10
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_internal_dep_state"] == "ceiling"
    assert out["bybit_internal_dep_rows"] == rec.FIELD_ABSENT
    assert out["bybit_inter_xfer_state"] == "read"


async def test_the_census_counts_transfer_like_log_rows_under_its_own_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Why: Earn, bonus-transfer and PEF log types are not flows in this phase, so the rebuild does not
    # replay them. The founder reads this ONE count at SC-3 to decide whether a6's rebuild is held, so
    # it must count exactly the eight candidate types, once per row, and say by token when it could not.
    assert rec.CENSUS_LOG_TYPES == (
        "ONCHAINEARN_SUBSCRIPTION",
        "ONCHAINEARN_REDEMPTION",
        "FLEXIBLE_STAKING_SUBSCRIPTION",
        "FLEXIBLE_STAKING_REDEMPTION",
        "BONUS_TRANSFER_IN",
        "BONUS_TRANSFER_OUT",
        "PEF_TRANSFER_IN",
        "PEF_TRANSFER_OUT",
    )
    assert rec.CENSUS_TIMEOUT_S == 600.0

    # (a) Counted: rows of the eight types, across several windows and more than one page; a row
    # returned under two stamps with one id counts once; an id-less row counts each time. Not counted:
    # the D-01 pair (they are flows, not census) and a trade.
    book = EvidenceBook()
    for index in range(120):  # three pages of 50 inside the newest window
        book.add_log("ONCHAINEARN_SUBSCRIPTION", _ago(1) - index, rid=f"fake-transfer-earn-{index}")
    book.add_log("BONUS_TRANSFER_IN", _ago(100), rid="fake-transfer-bonus")
    book.add_log("PEF_TRANSFER_OUT", _ago(500), rid="fake-transfer-pef-1")
    book.add_log("PEF_TRANSFER_OUT", _ago(501), rid="fake-transfer-pef-1")  # the same id again
    book.add_log("FLEXIBLE_STAKING_REDEMPTION", _ago(300))
    book.add_log("FLEXIBLE_STAKING_REDEMPTION", _ago(301))  # id-less rows count each time
    book.add_log("TRANSFER_IN", _ago(2), rid="fake-transfer-in")
    book.add_log("TRADE", _ago(3), rid="fake-transfer-trade")
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_other_transfer_like_rows"] == 120 + 1 + 1 + 2
    assert out["bybit_other_transfer_like_state"] == "read"

    # One type per request, the Unified account, a span the log accepts, both bounds as strings.
    calls = book.calls_to("transaction_log")
    assert {params["type"] for params in calls} == set(rec.CENSUS_LOG_TYPES)
    for params in calls:
        assert params["accountType"] == "UNIFIED"
        assert int(params["endTime"]) - int(params["startTime"]) <= 7 * DAY_MS
        assert isinstance(params["startTime"], str) and isinstance(params["endTime"], str)
        assert params["limit"] == "50"

    # (b) Its own bound: the census is run under CENSUS_TIMEOUT_S, not under a source's.
    waits: list[float] = []
    real_wait_for = asyncio.wait_for

    async def _spy(awaitable: Any, timeout: float | None = None) -> Any:
        waits.append(-1.0 if timeout is None else timeout)
        return await real_wait_for(awaitable, timeout)

    monkeypatch.setattr(rec.asyncio, "wait_for", _spy)
    monkeypatch.setattr(rec, "EVIDENCE_SOURCE_TIMEOUT_S", 123.0)
    monkeypatch.setattr(rec, "CENSUS_TIMEOUT_S", 456.0)
    await rec.measure_funding(_client(EvidenceBook(), monkeypatch), SINCE_MS, RUN_DAY)
    monkeypatch.undo()
    assert waits[-1] == 456.0 and set(waits[:-1]) == {123.0}, waits

    # A census that runs out of time is the state Timeout and no count; the sources before it kept theirs.
    monkeypatch.setattr(rec, "CENSUS_TIMEOUT_S", 0.05)
    book = EvidenceBook()
    book.add("internal_dep", _ago(10), 2, rid="fake-transfer-i1")
    book.effects["private_get_v5_account_transaction_log"] = ["hang"]
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_other_transfer_like_state"] == "Timeout"
    assert out["bybit_other_transfer_like_rows"] == rec.FIELD_ABSENT  # not a 0
    assert (out["bybit_internal_dep_state"], out["bybit_internal_dep_rows"]) == ("read", 1)
    monkeypatch.undo()

    # (c) A row of another type than the one asked for is malformed, and is never counted. On the very
    # first call no window was answered, so there is no count at all.
    book = EvidenceBook()
    book.effects["private_get_v5_account_transaction_log"] = ["wrong_type"]
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_other_transfer_like_state"] == "malformed"
    assert out["bybit_other_transfer_like_rows"] == rec.FIELD_ABSENT

    # The first window (eight types) answered; the second window's first answer carries a stranger.
    # What the first window held is kept, the stranger is not counted, and the state says malformed.
    book = EvidenceBook()
    book.add_log("BONUS_TRANSFER_IN", _ago(1), rid="fake-transfer-bonus")
    book.effects["private_get_v5_account_transaction_log"] = [None] * 8 + ["wrong_type"]
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_other_transfer_like_state"] == "malformed"
    assert out["bybit_other_transfer_like_rows"] == 1

    # (d) A log that was never answered is a state, never a 0: a refusal on the first call.
    book = EvidenceBook()
    book.effects["private_get_v5_account_transaction_log"] = [ccxt.PermissionDenied("fake refusal")]
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_other_transfer_like_state"] == "PermissionDenied"
    assert out["bybit_other_transfer_like_rows"] == rec.FIELD_ABSENT

    # A client with no such method (an older stub) is a state of its own class, never a raise.
    client = _client(EvidenceBook(), monkeypatch)
    del client.private_get_v5_account_transaction_log
    out = await rec.measure_funding(client, SINCE_MS, RUN_DAY)
    assert out["bybit_other_transfer_like_state"] == "other"
    assert out["bybit_other_transfer_like_rows"] == rec.FIELD_ABSENT


@pytest.mark.parametrize("name", SOURCE_NAMES)
async def test_a_source_past_its_bound_is_a_timeout_and_the_next_source_still_runs(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Why (T-180-04): a source that hangs must end by ITS OWN bound and say so by token. A count of 0
    # here would read as "this source holds nothing" and the founder would act on it. The sources after
    # it, and the census, are still read: one slow endpoint must not blank the rest of the record.
    monkeypatch.setattr(rec, "EVIDENCE_SOURCE_TIMEOUT_S", 0.05)
    book = EvidenceBook()
    for other in SOURCE_NAMES:
        book.add(other, _ago(10), _STATUSES[other][0][0], rid=f"fake-transfer-{other}")
    book.add_log("BONUS_TRANSFER_IN", _ago(10), rid="fake-transfer-bonus")
    book.effects[_RAW_METHOD[name]] = ["hang"]
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)

    assert out[f"bybit_{name}_state"] == "Timeout"
    for suffix in ("rows", "older_365d", "oldest_age_bucket", "other_status_rows", "depth_bucket"):
        assert out[f"bybit_{name}_{suffix}"] == rec.FIELD_ABSENT, suffix
    for other in SOURCE_NAMES:
        if other != name:
            assert (out[f"bybit_{other}_state"], out[f"bybit_{other}_rows"]) == ("read", 1), other
    assert (out["bybit_other_transfer_like_state"], out["bybit_other_transfer_like_rows"]) == ("read", 1)


async def test_a_source_that_times_out_after_a_window_keeps_that_window_and_says_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The second window hangs: the first window's row stays counted, the state is Timeout, and the
    # depth bucket says how far back the source answered, so the count reads as a lower bound.
    monkeypatch.setattr(rec, "EVIDENCE_SOURCE_TIMEOUT_S", 0.05)
    book = EvidenceBook()
    book.add("onchain_dep", _ago(10), "3", rid="fake-transfer-a")
    book.effects["private_get_v5_asset_deposit_query_record"] = [None, "hang"]
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_onchain_dep_state"] == "Timeout"
    assert out["bybit_onchain_dep_rows"] == 1
    assert out["bybit_onchain_dep_depth_bucket"] == "0-29"


async def test_the_key_info_read_is_bounded_too(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rec, "EVIDENCE_SOURCE_TIMEOUT_S", 0.05)
    book = EvidenceBook()
    book.effects["private_get_v5_user_query_api"] = ["hang"]
    out = await rec.measure_funding(_client(book, monkeypatch), SINCE_MS, RUN_DAY)
    assert out["bybit_key_info_state"] == "Timeout"
    assert out["bybit_onchain_dep_state"] == "read"


async def test_measure_funding_never_raises_and_returns_only_funding_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Why: the evidence is a side measurement taken after a member's snapshot. If it could raise, a
    # venue outage would turn a member that read fine into a failed one. Every read here raises, and
    # the answer is still the declared keys with a closed state each (an exception's class, never its
    # message, which could carry an id or an amount).
    monkeypatch.setattr(rec, "_now_ms", lambda: NOW_MS)
    client = SimpleNamespace()

    def _raiser() -> Any:
        async def _call(*_args: Any, **_kwargs: Any) -> Any:
            raise RuntimeError("fake-transfer-secret-text 9137.45")

        return _call

    for method in METHODS:
        setattr(client, method, _raiser())
    out = await rec.measure_funding(client, SINCE_MS, RUN_DAY)

    assert list(out) == list(rec.FUNDING_KEYS)
    assert out["bybit_key_info_state"] == "other"
    assert out["bybit_other_transfer_like_state"] == "other"
    for name in SOURCE_NAMES:
        assert out[f"bybit_{name}_state"] == "other", name
        assert out[f"bybit_{name}_rows"] == rec.FIELD_ABSENT, name
    assert out["bybit_other_transfer_like_rows"] == rec.FIELD_ABSENT
    assert "fake-transfer-secret-text" not in repr(out) and "9137.45" not in repr(out)
    for key, value in out.items():
        assert rec.FUNDING_VALIDATORS[key](value), key


def test_the_record_module_names_only_read_endpoints() -> None:
    # Why (T-180-02): this module is the part of the probe that talks to the venue most. Its source
    # text must name exactly the seven raw GET methods and nothing that writes, so adding a venue write
    # or a database write is a red test and not a review catch. The module's own comments and
    # docstrings are held to it too, which is why they describe such calls in words.
    src = Path(rec.__file__).read_text(encoding="utf-8")
    assert set(re.findall(r"private_get_v5_[a-z_]+", src)) == {
        "private_get_v5_asset_deposit_query_record",
        "private_get_v5_asset_deposit_query_internal_record",
        "private_get_v5_asset_withdraw_query_record",
        "private_get_v5_asset_transfer_query_inter_transfer_list",
        "private_get_v5_asset_transfer_query_universal_transfer_list",
        "private_get_v5_user_query_api",
        "private_get_v5_account_transaction_log",
    }
    assert not re.search(r"\b(create_order|cancel_order|withdraw|transfer)\(", src)
    assert not re.search(r"\bprivate_(post|put|delete)_", src)
    for write in (".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", ".table(", "enqueue"):
        assert write not in src, write


def test_the_defaults_and_validators_cover_exactly_the_declared_keys() -> None:
    assert set(rec.funding_defaults()) == set(rec.FUNDING_KEYS) == set(rec.FUNDING_VALIDATORS)
    for key, value in rec.funding_defaults().items():
        assert rec.FUNDING_VALIDATORS[key](value), key
    # The closed vocabulary refuses anything else, and a count is never negative or a boolean.
    assert not rec.FUNDING_VALIDATORS["bybit_onchain_dep_state"]("PermissionDenied: fake")
    assert not rec.FUNDING_VALIDATORS["bybit_onchain_dep_rows"](-1)
    assert not rec.FUNDING_VALIDATORS["bybit_onchain_dep_rows"](True)
    assert not rec.FUNDING_VALIDATORS["bybit_onchain_dep_depth_bucket"]("1234")
    assert not rec.FUNDING_VALIDATORS["bybit_is_master"]("true")
    assert set(METHODS) >= set(_RAW_METHOD.values())
