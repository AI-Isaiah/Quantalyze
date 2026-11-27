"""Phase 252 plan 06 - tests for ``scripts/deribit_options_smoothed_probe.py``.

The probe is the wave-2 measurement tooling (CONTEXT Wave 2, "measure before promoting"): a
read-only question put to a composite's Deribit member keys. Does the existing smoothed
mark-to-market reconstruction compute for them? The criteria are structural and fixed in the
probe's docstring before any run: the build completes (C1, C2), no option day falls back to the
cash wallet (C3), and the series reconciles (C4). There is no magnitude bound (D-05).

Every build below goes through the probe's real seams (``build_deribit_native_ledger`` is the
one stubbed seam, returning the Phase 185 round-trip ledger pair) and every series through the
REAL ``combine_native_ledger``. Nothing here proves the live accounts pass; that is the
founder-gated post-ship run. What these tests prove is that every criterion CAN fail, that the
output cannot carry an amount, and that the probe cannot write or flip the switch.

Why each group matters (Rule 9):
  * criteria arms: a verdict that cannot go ``fail`` on a hole, a cash-bucketed day or a series
    that does not reconcile would let a promotion proceed on a headline that is wrong.
  * redaction: the output is pasted into a tracked file in a public repo. An amount, a date, an
    id or a credential there is a disclosure.
  * source pins and environment: the run happens on PROD keys, so the probe must provably be
    unable to write, enqueue a job, or change the smoothed switch.
"""
from __future__ import annotations

import inspect
import json
import re
from pathlib import Path
from typing import Any

import pytest

from scripts import deribit_options_smoothed_probe as probe
from services import deribit_ingest as di
from services.broker_dailies import combine_native_ledger
from services.closed_sets import is_smoothed_mtm_enabled
from services.deribit_ingest import (
    CompletenessReport,
    DeribitTransientReadError,
    LedgerCompletenessError,
)
from services.deribit_txn import (
    PNL_BASIS_CASH_SETTLEMENT,
    PNL_BASIS_SMOOTHED_MTM,
    LedgerValuationError,
    OptionExerciseRowError,
    OptionExpiryRowError,
    OptionRowFieldMissingError,
)
from services.nav_twr import NavReconstructionError
from services.native_nav import InceptionReconciliationError
from tests.fixtures.deribit_option_round_trip import (
    ROUND_TRIP_S,
    cash_round_trip_ledger,
    options_round_trip_ledger,
)
from tests.test_deribit_ingest import _NativeAnchorStub
from tests.test_smoothed_mtm_core import _mk_ms, _opt_row, _OptionsAdapterStub

_PROBE_SRC = Path(probe.__file__).read_text(encoding="utf-8")

_SMOOTHED = PNL_BASIS_SMOOTHED_MTM
_CASH = PNL_BASIS_CASH_SETTLEMENT

# Stub identifiers. None of these may ever appear in an output line.
_STRATEGY_ID = "strat-7c1d-stub-0001"
_KEY_STUB = "KEY-STUB-AAAA-1111"
_SECRET_STUB = "SECRET-STUB-BBBB-2222"
_API_KEY_IDS = ("row-m1", "row-m2")

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


async def _no_sleep(_s: float) -> None:
    return None


def _report(*, bucketed: int = 0, option_activity: bool = True) -> CompletenessReport:
    """A complete crawl report: nothing expected, so ``assert_ledger_complete`` passes. The
    pre-mark-retention list carries ``bucketed`` (currency, day) pairs. The fixtures are an
    options book, so option activity is on unless a test turns it off."""
    days = [("USDC", f"2025-07-{11 + i:02d}") for i in range(bucketed)]
    return CompletenessReport(
        indexable_currencies=frozenset(),
        pre_mark_retention_option_days=days,
        has_option_activity=option_activity,
    )


def _incomplete_report() -> CompletenessReport:
    """A crawl that owed (main, BTC) and never reached its end: the completeness gate raises."""
    return CompletenessReport(expected={"main": ["BTC"]}, entries={})


def _fixture_pair(*, bucketed: int = 0) -> dict[str, Any]:
    """The seam's result per basis: the smoothed (options) ledger and the cash ledger."""
    return {
        _SMOOTHED: (options_round_trip_ledger(), _report(bucketed=bucketed)),
        _CASH: (cash_round_trip_ledger(), _report()),
    }


def _install_seam(
    monkeypatch: Any, results: dict[str, Any], calls: list[dict[str, Any]]
) -> None:
    """Replace the probe's ``build_deribit_native_ledger``. A result that is an exception is
    raised, anything else is returned as the ``(ledger, report)`` pair."""

    async def _build(exchange: Any, *, account_state: Any, **kw: Any) -> Any:
        calls.append(dict(kw))
        result = results[kw["pnl_basis"]]
        if isinstance(result, BaseException):
            raise result
        return result

    monkeypatch.setattr(probe, "build_deribit_native_ledger", _build)


def _stub_exchange() -> _NativeAnchorStub:
    return _NativeAnchorStub(
        summaries=[{"currency": "USDC", "equity": 1.0, "session_upl": 0.0}],
        index_price=None,
    )


async def _measure(
    monkeypatch: Any,
    results: dict[str, Any],
    *,
    config: Any = None,
    calls: list[dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """One member through the live seam on the stub exchange; the records by basis."""
    _install_seam(monkeypatch, results, [] if calls is None else calls)
    records = await probe.measure_member_live(
        _stub_exchange(), "m1", config, sleep=_no_sleep
    )
    return {r["basis"]: r for r in records}


def _series_ordinal(ledger: Any, *, largest: bool = True) -> int:
    """The position of the largest-|return| day in the series the REAL combine returns, found
    independently of the probe (an index lookup, not the probe's ranking)."""
    series, _meta = combine_native_ledger(ledger, frozenset())
    day = series.abs().idxmax()
    return int(series.index.get_loc(day))


# ---------------------------------------------------------------------------
# Task 1: the tracer. One composite measured on a stubbed exchange.
# ---------------------------------------------------------------------------


async def test_the_fixture_pair_measures_pass_on_smoothed_and_contrast_on_cash(
    monkeypatch: Any,
) -> None:
    recs = await _measure(monkeypatch, _fixture_pair())
    smoothed, cash = recs[_SMOOTHED], recs[_CASH]

    assert (smoothed["build"], smoothed["c3"], smoothed["c4"]) == ("ok", "pass", "pass")
    assert smoothed["member_verdict"] == "pass"
    assert cash["member_verdict"] == "contrast"  # the cash basis is printed, never judged

    # C5 (report only). The cash basis is the Phase 185 extreme day: one day above one half,
    # and its largest day is the delivery day, found independently on the real series.
    assert cash["days_over_half"] == 1
    assert cash["top_ordinals"][0] == _series_ordinal(cash_round_trip_ledger()) == 3
    # The smoothed basis spreads the same P&L: still one day above one half (about +0.96),
    # the same delivery day.
    assert smoothed["days_over_half"] == 1
    assert smoothed["top_ordinals"][0] == _series_ordinal(options_round_trip_ledger()) == 3
    assert smoothed["days_over_guard"] == cash["days_over_guard"] == 0
    # The funding day is NaN and is skipped, never ranked or counted.
    assert smoothed["series_days"] == cash["series_days"] == 4
    assert 0 not in smoothed["top_ordinals"] and 0 not in cash["top_ordinals"]


async def test_each_basis_is_built_exactly_once_with_the_composite_arms_own_arguments(
    monkeypatch: Any,
) -> None:
    calls: list[dict[str, Any]] = []
    await _measure(monkeypatch, _fixture_pair(), calls=calls)
    assert [c["pnl_basis"] for c in calls] == [_SMOOTHED, _CASH]  # once each, smoothed first
    # A composite with no returns_denominator_config does not exclude spot extraction.
    assert all(c["exclude_spot_extraction"] is False for c in calls)


async def test_a_configured_composite_excludes_spot_extraction_as_the_composite_arm_does(
    monkeypatch: Any,
) -> None:
    from services.allocated_capital import parse_returns_denominator_config

    config = parse_returns_denominator_config(
        {
            "denominator": "allocated_capital",
            "pnl_basis": "cash_settlement",
            "metrics_basis": "active_day",
            "capital_schedule": [{"effective_from": "2025-07-10", "capital_usd": 1000.0}],
        }
    )
    assert config is not None
    calls: list[dict[str, Any]] = []
    recs = await _measure(monkeypatch, _fixture_pair(), config=config, calls=calls)
    assert all(c["exclude_spot_extraction"] is True for c in calls)
    assert recs[_SMOOTHED]["build"] == "ok"  # the combine ran with the strategy's own config


async def test_a_bucketed_option_day_fails_c3_and_the_member(monkeypatch: Any) -> None:
    """C3: an option day in ``pre_mark_retention_option_days`` falls back to the cash wallet
    inside a promoted headline, so the member fails. The count is printed, never the days."""
    recs = await _measure(monkeypatch, _fixture_pair(bucketed=2))
    smoothed = recs[_SMOOTHED]
    assert smoothed["build"] == "ok"
    assert smoothed["c3"] == "fail"
    assert smoothed["bucketed_days"] == 2
    assert smoothed["member_verdict"] == "fail"
    # c4 is judged on whatever built; C3 is its own observation.
    assert smoothed["c4"] == "pass"


async def test_the_exchange_is_read_once_for_the_anchor_and_only_through_the_proxy(
    monkeypatch: Any,
) -> None:
    stub = _stub_exchange()
    _install_seam(monkeypatch, _fixture_pair(), [])
    await probe.measure_member_live(stub, "m1", None, sleep=_no_sleep)
    assert stub.summaries_calls == 1  # ONE anchor read for both bases


# --- run(): the CLI path on a stubbed database and exchange ------------------


class _Resp:
    def __init__(self, data: Any) -> None:
        self.data = data


class _Query:
    """A PostgREST query stub with the SELECT surface only: a write verb is an AttributeError."""

    def __init__(self, table: str, store: dict[str, Any]) -> None:
        self._table = table
        self._store = store
        self._filters: dict[str, Any] = {}
        self._single = False

    def select(self, *_a: Any, **_k: Any) -> "_Query":
        return self

    def eq(self, column: str, value: Any) -> "_Query":
        self._filters[column] = value
        return self

    def order(self, *_a: Any, **_k: Any) -> "_Query":
        return self

    def single(self) -> "_Query":
        self._single = True
        return self

    def maybe_single(self) -> "_Query":
        return self

    def execute(self) -> _Resp:
        if self._table == "api_keys":
            return _Resp(self._store["api_keys"].get(self._filters["id"]))
        if self._single and self._store[self._table] is None:
            # PostgREST's ``.single()`` raises on zero rows; ``.maybe_single()`` does not.
            raise RuntimeError("no rows for .single()")
        return _Resp(self._store[self._table])


class _FakeSupabase:
    def __init__(self, store: dict[str, Any]) -> None:
        self._store = store

    def table(self, name: str) -> _Query:
        return _Query(name, self._store)


def _store(
    *,
    config: Any = None,
    key_overrides: dict[int, dict[str, Any] | None] | None = None,
) -> dict[str, Any]:
    keys: dict[str, Any] = {
        key_id: {
            "id": key_id,
            "exchange": "deribit",
            "is_active": True,
            "encrypted_blob": "stub",
        }
        for key_id in _API_KEY_IDS
    }
    for index, override in (key_overrides or {}).items():
        if override is None:
            del keys[_API_KEY_IDS[index]]
        else:
            keys[_API_KEY_IDS[index]] = {**keys[_API_KEY_IDS[index]], **override}
    return {
        "strategies": {"id": _STRATEGY_ID, "returns_denominator_config": config},
        "strategy_keys": [
            {"api_key_id": key_id, "seq": seq} for seq, key_id in enumerate(_API_KEY_IDS)
        ],
        "api_keys": keys,
    }


def _patch_run_io(
    monkeypatch: Any, store: dict[str, Any], decrypted: list[Any], closed: list[Any]
) -> None:
    import services.db as db
    import services.encryption as enc
    import services.exchange as exch
    import services.job_worker as jw

    monkeypatch.setattr(db, "get_supabase", lambda: _FakeSupabase(store))
    monkeypatch.setattr(enc, "get_kek", lambda: b"kek-stub")

    def _decrypt(row: dict[str, Any], _kek: bytes) -> tuple[str, str, None]:
        decrypted.append(row["id"])
        return _KEY_STUB, _SECRET_STUB, None

    monkeypatch.setattr(enc, "decrypt_credentials", _decrypt)
    monkeypatch.setattr(
        jw, "_make_exchange_client", lambda *_a, **_k: _stub_exchange()
    )

    async def _close(exchange: Any) -> None:
        closed.append(exchange)

    monkeypatch.setattr(exch, "aclose_exchange", _close)


def _json_lines(out: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in out.splitlines() if line.startswith("{")]


async def test_run_prints_four_records_and_one_pass_verdict_for_two_members(
    monkeypatch: Any, capsys: Any
) -> None:
    decrypted: list[Any] = []
    closed: list[Any] = []
    _patch_run_io(monkeypatch, _store(), decrypted, closed)
    calls: list[dict[str, Any]] = []
    _install_seam(monkeypatch, _fixture_pair(), calls)

    code = await probe.run(_STRATEGY_ID)

    assert code == probe.EXIT_OK == 0
    out = capsys.readouterr().out
    lines = out.splitlines()
    assert len(lines) == 5, lines  # four records (two members x two bases) and one verdict
    parsed = [json.loads(line) for line in lines]  # every line is JSON
    for record in parsed[:4]:
        probe.validate_record(record)
    assert [(r["member"], r["basis"]) for r in parsed[:4]] == [
        ("m1", _SMOOTHED),
        ("m1", _CASH),
        ("m2", _SMOOTHED),
        ("m2", _CASH),
    ]
    assert parsed[4] == {"verdict": "pass", "members": 2, "failed_members": 0}
    probe.validate_record(parsed[4])
    assert decrypted == list(_API_KEY_IDS)
    assert len(closed) == 2  # every client is closed
    assert len(calls) == 4


@pytest.mark.parametrize(
    "override",
    [
        {"exchange": "binance"},  # not a deribit key
        {"is_active": False},  # inactive
        None,  # missing key row
    ],
    ids=["not-deribit", "inactive", "missing"],
)
async def test_an_unmeasurable_member_is_refused_before_any_decrypt(
    monkeypatch: Any, capsys: Any, override: dict[str, Any] | None
) -> None:
    decrypted: list[Any] = []
    _patch_run_io(monkeypatch, _store(key_overrides={1: override}), decrypted, [])
    # Even m1, which IS measurable, must not be decrypted: refusal covers every member first.
    _install_seam(monkeypatch, _fixture_pair(), [])

    code = await probe.run(_STRATEGY_ID)

    assert code == probe.EXIT_REFUSED == 2
    assert decrypted == []  # decrypt_credentials never ran
    captured = capsys.readouterr()
    assert captured.out == ""  # no record, no verdict
    assert _STRATEGY_ID not in captured.err and _API_KEY_IDS[1] not in captured.err


@pytest.mark.parametrize(
    ("row", "refused"),
    [
        ({"exchange": "deribit", "is_active": True}, False),
        ({"exchange": "binance", "is_active": True}, True),
        ({"exchange": "deribit", "is_active": False}, True),
        ({"exchange": "deribit"}, True),
    ],
)
def test_refusal_reason_only_admits_an_active_deribit_key(
    row: dict[str, Any], refused: bool
) -> None:
    assert (probe.refusal_reason(row) is not None) is refused


# ---------------------------------------------------------------------------
# Task 2: every failure arm.
# ---------------------------------------------------------------------------

# A message that embeds an amount, a row id and an account. None of it may reach an output line.
_LEAKY_MESSAGE = "unconvertible row id 90210 value 98765.4321 account acct-5555-stub"


class _OffListValuationError(LedgerValuationError):
    """A LedgerValuationError subclass the emitter's allow-list does not know."""


class _OffListNavError(NavReconstructionError):
    """A NavReconstructionError subclass the C4 allow-list does not know."""


async def test_a_valuation_error_fails_the_smoothed_build_and_is_never_retried(
    monkeypatch: Any,
) -> None:
    results = {**_fixture_pair(), _SMOOTHED: LedgerValuationError(_LEAKY_MESSAGE)}
    calls: list[dict[str, Any]] = []
    recs = await _measure(monkeypatch, results, calls=calls)
    smoothed = recs[_SMOOTHED]
    assert smoothed["build"] == "build-error:LedgerValuationError"
    assert smoothed["build_error_detail"] == "LedgerValuationError"  # the class, not the message
    assert (smoothed["c3"], smoothed["c4"]) == ("not-run", "not-run")
    assert smoothed["member_verdict"] == "fail"
    assert probe.verdict_record(list(recs.values())) == {
        "verdict": "fail",
        "members": 1,
        "failed_members": 1,
    }
    assert [c["pnl_basis"] for c in calls] == [_SMOOTHED, _CASH]  # smoothed built once


async def test_a_transient_read_fails_the_member_and_is_never_retried(
    monkeypatch: Any,
) -> None:
    results = {**_fixture_pair(), _SMOOTHED: DeribitTransientReadError("read blip")}
    calls: list[dict[str, Any]] = []
    recs = await _measure(monkeypatch, results, calls=calls)
    assert recs[_SMOOTHED]["build"] == "build-error:DeribitTransientReadError"
    assert recs[_SMOOTHED]["member_verdict"] == "fail"
    assert sum(1 for c in calls if c["pnl_basis"] == _SMOOTHED) == 1


async def test_a_hole_in_the_daily_marks_names_its_field(monkeypatch: Any) -> None:
    """C2: the hole guard's class AND the field it names tell which criterion failed."""
    message = "option row 77 lacks the position field the smoothed replay needs"
    results = {**_fixture_pair(), _SMOOTHED: OptionRowFieldMissingError(message)}
    smoothed = (await _measure(monkeypatch, results))[_SMOOTHED]
    assert smoothed["build"] == "build-error:OptionRowFieldMissingError"
    assert smoothed["build_error_detail"] == "OptionRowFieldMissingError:position"
    assert smoothed["member_verdict"] == "fail"


async def test_an_incomplete_crawl_fails_the_member(monkeypatch: Any) -> None:
    results = {**_fixture_pair(), _SMOOTHED: (options_round_trip_ledger(), _incomplete_report())}
    smoothed = (await _measure(monkeypatch, results))[_SMOOTHED]
    assert smoothed["build"] == "ledger-incomplete"
    assert smoothed["build_error_detail"] is None
    assert smoothed["member_verdict"] == "fail"
    assert (smoothed["c3"], smoothed["c4"]) == ("not-run", "not-run")
    with pytest.raises(LedgerCompletenessError):  # control: the stub report really is incomplete
        di.assert_ledger_complete(_incomplete_report())


async def test_a_build_error_class_off_the_allow_list_is_emitted_as_other(
    monkeypatch: Any,
) -> None:
    """A class the emitter does not know must not make it refuse the whole record: the PROD
    run would otherwise exit 1 with no record at all."""
    results = {**_fixture_pair(), _SMOOTHED: _OffListValuationError(_LEAKY_MESSAGE)}
    smoothed = (await _measure(monkeypatch, results))[_SMOOTHED]
    assert smoothed["build"] == "build-error:other"
    assert smoothed["build_error_detail"] == "other"
    probe.emit_record(smoothed)  # and it is emittable


@pytest.mark.parametrize(
    ("raised", "word"),
    [
        (InceptionReconciliationError(currencies=["USDC"], venue="deribit", breach_ratio=9.0),
         "fail:InceptionReconciliationError"),
        (_OffListNavError("residual 4242.42 on account acct-5555-stub"),
         "fail:NavReconstructionError"),
    ],
    ids=["inception-reconciliation", "off-list-subclass"],
)
async def test_a_series_that_does_not_reconcile_fails_c4(
    monkeypatch: Any, raised: BaseException, word: str
) -> None:
    def _raises(*_a: Any, **_k: Any) -> Any:
        raise raised

    monkeypatch.setattr(probe, "combine_native_ledger", _raises)
    smoothed = (await _measure(monkeypatch, _fixture_pair()))[_SMOOTHED]
    assert smoothed["build"] == "ok" and smoothed["c3"] == "pass"
    assert smoothed["c4"] == word
    assert smoothed["member_verdict"] == "fail"
    assert smoothed["series_days"] == 0  # no series, so no C5 reading
    probe.emit_record(smoothed)


async def test_the_cash_basis_failing_alone_leaves_the_verdict_pass(monkeypatch: Any) -> None:
    results = {**_fixture_pair(), _CASH: LedgerValuationError(_LEAKY_MESSAGE)}
    recs = await _measure(monkeypatch, results)
    assert recs[_CASH]["build"] == "build-error:LedgerValuationError"
    assert recs[_CASH]["member_verdict"] == "contrast"  # contrast never gates
    assert recs[_SMOOTHED]["member_verdict"] == "pass"
    assert probe.verdict_record(list(recs.values()))["verdict"] == "pass"


async def test_one_failing_member_makes_the_verdict_fail(
    monkeypatch: Any, capsys: Any
) -> None:
    _patch_run_io(monkeypatch, _store(), [], [])
    built: list[str] = []

    async def _build(exchange: Any, *, account_state: Any, **kw: Any) -> Any:
        built.append(kw["pnl_basis"])
        if len(built) == 3:  # m2's smoothed build
            raise LedgerValuationError(_LEAKY_MESSAGE)
        return _fixture_pair()[kw["pnl_basis"]]

    monkeypatch.setattr(probe, "build_deribit_native_ledger", _build)

    assert await probe.run(_STRATEGY_ID) == probe.EXIT_OK  # a measured failure is a result
    parsed = _json_lines(capsys.readouterr().out)
    assert parsed[-1] == {"verdict": "fail", "members": 2, "failed_members": 1}
    by_member = {(r["member"], r["basis"]): r for r in parsed[:-1]}
    assert by_member[("m1", _SMOOTHED)]["member_verdict"] == "pass"
    assert by_member[("m2", _SMOOTHED)]["member_verdict"] == "fail"


async def test_a_perp_only_member_fails_and_the_verdict_fails(monkeypatch: Any) -> None:
    """C6: a book with no option activity builds, reconciles and has a series, so C1 to C4 all
    pass, and it would be a ``pass`` resting on no option evidence. It is a fail."""
    results = {
        **_fixture_pair(),
        _SMOOTHED: (options_round_trip_ledger(), _report(option_activity=False)),
    }
    recs = await _measure(monkeypatch, results)
    smoothed = recs[_SMOOTHED]
    assert (smoothed["build"], smoothed["c3"], smoothed["c4"]) == ("ok", "pass", "pass")
    assert smoothed["series_days"] > 0  # the only thing missing is the option activity
    assert smoothed["option_activity"] == "no"
    assert smoothed["member_verdict"] == "fail"
    assert probe.verdict_record(list(recs.values())) == {
        "verdict": "fail",
        "members": 1,
        "failed_members": 1,
    }
    probe.emit_record(smoothed)


async def test_a_zero_day_series_fails_the_member(monkeypatch: Any) -> None:
    """C6: a series with no day is no measurement, even when the combine returns without a
    raise."""
    import pandas as pd

    def _empty(*_a: Any, **_k: Any) -> Any:
        return pd.Series([], dtype=float), {}

    monkeypatch.setattr(probe, "combine_native_ledger", _empty)
    smoothed = (await _measure(monkeypatch, _fixture_pair()))[_SMOOTHED]
    assert (smoothed["build"], smoothed["c3"], smoothed["c4"]) == ("ok", "pass", "pass")
    assert smoothed["option_activity"] == "yes"  # the only thing missing is the series
    assert smoothed["series_days"] == 0
    assert smoothed["member_verdict"] == "fail"


def test_a_verdict_without_a_judged_member_with_option_activity_is_a_fail() -> None:
    """The verdict line re-checks C6 over the records, so a member verdict of ``pass`` on a
    record that names no option activity cannot carry the run."""
    record = {**_honest_record(), "option_activity": "no"}
    assert probe.verdict_record([record]) == {
        "verdict": "fail",
        "members": 1,
        "failed_members": 0,
    }
    assert probe.verdict_record([_honest_record()])["verdict"] == "pass"  # control


def test_no_judged_member_is_never_a_pass() -> None:
    assert probe.verdict_record([]) == {"verdict": "fail", "members": 0, "failed_members": 0}


# --- C5: counts and ordinals ---------------------------------------------------


def test_the_c5_counts_and_ordinals_on_a_synthetic_series() -> None:
    import pandas as pd

    from services.nav_twr import PNL_DOM_RATIO

    series = pd.Series(
        [float("nan"), 0.5, -0.50001, PNL_DOM_RATIO, -(PNL_DOM_RATIO - 0.01), 0.1, 0.2, 0.3]
    )
    report = probe._series_report(series)
    assert report["series_days"] == 8  # the NaN day is a day of the series
    assert report["days_over_guard"] == 1  # "at least" the guard: the day AT it counts
    assert report["days_over_half"] == 3  # "above" one half: exactly 0.5 does not count
    assert report["top_ordinals"] == [3, 4, 2, 1, 7]  # largest |return| first, NaN skipped, <= 5


# --- redaction -----------------------------------------------------------------


def _distinctive_texts() -> set[str]:
    """Amounts the fixture ledgers carry and the returns they produce, in every spelling."""
    amounts = [ROUND_TRIP_S, 0.4839 * ROUND_TRIP_S, 1.7688 * ROUND_TRIP_S, 0.6016 * ROUND_TRIP_S]
    returns = [3.3342, 0.9585, 0.174, 0.4839, 0.0279, 1.2993]
    texts: set[str] = set()
    for value in (*amounts, *returns):
        texts |= {repr(value), str(value), f"{value:g}", f"{value:.4f}"}
    texts |= {"98765.4321", "90210", "acct-5555-stub"}
    return texts


async def test_no_output_line_carries_an_amount_date_credential_or_id(
    monkeypatch: Any, capsys: Any
) -> None:
    _patch_run_io(monkeypatch, _store(), [], [])
    results = {**_fixture_pair(), _SMOOTHED: LedgerValuationError(_LEAKY_MESSAGE)}
    _install_seam(monkeypatch, results, [])
    healthy: list[str] = []

    # Both a failing and a passing member go through the same emitter; print them both.
    await probe.run(_STRATEGY_ID)
    failing = capsys.readouterr()
    _install_seam(monkeypatch, _fixture_pair(), [])
    await probe.run(_STRATEGY_ID)
    passing = capsys.readouterr()
    healthy.extend([failing.out, failing.err, passing.out, passing.err])

    for text in healthy:
        for needle in _distinctive_texts():
            assert needle not in text, f"{needle!r} reached the output"
        for stub in (_STRATEGY_ID, _KEY_STUB, _SECRET_STUB, *_API_KEY_IDS):
            assert stub not in text
        assert not _DATE_RE.search(text)
        assert not re.search(r"\d{2}:\d{2}:\d{2}", text)
        assert not re.search(r"\d\.\d", text)  # no decimal figure of any kind
    assert passing.out.count("\n") == 5 and failing.out.count("\n") == 5


def _honest_record() -> dict[str, Any]:
    return {
        "member": "m1",
        "basis": _SMOOTHED,
        "build": "ok",
        "build_error_detail": None,
        "c3": "pass",
        "bucketed_days": 0,
        "option_activity": "yes",
        "c4": "pass",
        "member_verdict": "pass",
        "series_days": 4,
        "days_over_guard": 0,
        "days_over_half": 1,
        "top_ordinals": [3, 2, 1],
        "refusal_shape": None,
    }


def test_the_honest_record_and_the_verdict_line_are_emittable() -> None:
    assert json.loads(probe.emit_record(_honest_record()))["top_ordinals"] == [3, 2, 1]
    probe.emit_record({"verdict": "pass", "members": 2, "failed_members": 0})


@pytest.mark.parametrize(
    "mutation",
    [
        {"days_over_half": 2.0},  # a float
        {"top_ordinals": [3, 2.0]},  # a float inside a list
        {"equity": 1.5},  # a key outside the whitelist
        {"build": "2025-07-13"},  # a date string
        {"build": "build-error:Secret"},  # a class off the allow-list
        {"build": "boom: account 12345678"},  # free text
        {"build_error_detail": "LedgerValuationError:row 90210"},  # free text in the detail
        {"member": "m123"},  # a label outside m<digits>
        {"basis": "mark_to_market"},  # a basis the probe does not measure
        {"c4": "fail:Boom"},  # a C4 class off the allow-list
        {"top_ordinals": [1, 2, 3, 4, 5, 6]},  # a sixth ordinal
        {"top_ordinals": ["3"]},  # a string ordinal
        {"bucketed_days": True},  # a bool as a count
        {"days_over_guard": -1},  # a negative count
        {"member_verdict": "maybe"},  # a verdict word outside the vocabulary
        {"option_activity": "maybe"},  # an activity word outside yes/no
        {"option_activity": True},  # a bool where the closed word belongs
    ],
    ids=lambda m: next(iter(m)) + "=" + repr(next(iter(m.values()))),
)
def test_the_emitter_refuses_a_key_or_a_value_outside_the_vocabulary(
    mutation: dict[str, Any],
) -> None:
    probe.emit_record(_honest_record())  # control: the honest record prints
    with pytest.raises(ValueError):
        probe.emit_record({**_honest_record(), **mutation})


def test_the_emitter_refuses_a_missing_key_and_a_malformed_verdict_line() -> None:
    record = _honest_record()
    del record["c4"]
    with pytest.raises(ValueError):
        probe.emit_record(record)
    for bad in (
        {"verdict": "pass", "members": 2},  # a key short
        {"verdict": "pass", "members": 2, "failed_members": 0.0},  # a float
        {"verdict": "maybe", "members": 2, "failed_members": 0},
        {"verdict": "pass", "members": 2, "failed_members": 0, "note": "x"},
    ):
        with pytest.raises(ValueError):
            probe.emit_record(bad)


def test_a_refusal_names_the_path_and_never_the_value() -> None:
    with pytest.raises(ValueError) as caught:
        probe.emit_record({**_honest_record(), "days_over_half": 7654.321})
    assert "days_over_half" in str(caught.value)
    assert "7654.321" not in str(caught.value)


# --- run() failure paths and main ----------------------------------------------


async def test_a_malformed_denominator_config_prints_its_type_only(
    monkeypatch: Any, capsys: Any
) -> None:
    decrypted: list[Any] = []
    _patch_run_io(
        monkeypatch,
        _store(config={"denominator": "SECRET-BAD-9999"}),
        decrypted,
        [],
    )
    code = await probe.run(_STRATEGY_ID)
    captured = capsys.readouterr()
    assert code == probe.EXIT_FAILED
    assert captured.out == ""
    assert captured.err.strip() == "failed: ReturnsDenominatorConfigError"
    assert "SECRET-BAD-9999" not in captured.err
    assert decrypted == []


async def test_a_missing_strategy_is_refused_with_exit_two(
    monkeypatch: Any, capsys: Any
) -> None:
    """IN-07: ``.single()`` raises on a missing row, so the refusal never fired and the run
    ended in exit 1. ``.maybe_single()`` returns no row and the documented refusal (exit 2)
    fires before any decrypt."""
    store = _store()
    store["strategies"] = None
    decrypted: list[Any] = []
    _patch_run_io(monkeypatch, store, decrypted, [])
    assert await probe.run(_STRATEGY_ID) == probe.EXIT_REFUSED == 2
    captured = capsys.readouterr()
    assert decrypted == [] and captured.out == ""
    assert "no such strategy" in captured.err


async def test_a_composite_with_no_members_is_refused(monkeypatch: Any, capsys: Any) -> None:
    store = _store()
    store["strategy_keys"] = []
    decrypted: list[Any] = []
    _patch_run_io(monkeypatch, store, decrypted, [])
    assert await probe.run(_STRATEGY_ID) == probe.EXIT_REFUSED
    assert decrypted == [] and capsys.readouterr().out == ""


@pytest.fixture
def _logging_restored() -> Any:
    """main() switches logging off for the whole process; give it back."""
    import logging

    yield
    logging.disable(logging.NOTSET)


def test_main_prints_only_the_exception_type_on_failure(
    monkeypatch: Any, capsys: Any, _logging_restored: Any
) -> None:
    async def _boom(_strategy_id: str) -> int:
        raise ValueError(_LEAKY_MESSAGE)

    monkeypatch.setattr(probe, "run", _boom)
    assert probe.main(["--strategy-id", _STRATEGY_ID]) == probe.EXIT_FAILED
    captured = capsys.readouterr()
    assert captured.err.strip() == "failed: ValueError"
    assert captured.out == ""


def test_main_refuses_without_a_strategy_id() -> None:
    with pytest.raises(SystemExit) as exc:
        probe.main([])
    assert exc.value.code != 0
    assert inspect.iscoroutinefunction(probe.run)


def test_the_exit_codes_are_the_documented_ones() -> None:
    assert (probe.EXIT_OK, probe.EXIT_FAILED, probe.EXIT_REFUSED) == (0, 1, 2)


# --- source pins ---------------------------------------------------------------


def test_the_probe_cannot_write_enqueue_or_run_the_preflight() -> None:
    assert "_allocator_key_preflight(" not in _PROBE_SRC
    for verb in (".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "enqueue"):
        assert verb not in _PROBE_SRC, verb


def test_the_probe_never_names_the_stitch_job_or_the_switch_or_the_environment() -> None:
    assert "run_stitch_composite_job" not in _PROBE_SRC
    assert "SMOOTHED_MTM_ENABLED" not in _PROBE_SRC
    for env in ("os.environ", "putenv", "getenv"):
        assert env not in _PROBE_SRC, env


def test_the_probe_imports_the_guard_ratio_and_restates_no_threshold() -> None:
    assert re.search(r"^from services\.nav_twr import .*\bPNL_DOM_RATIO\b", _PROBE_SRC, re.M)
    # No name that reads as a ratio, tolerance, guard, threshold or floor takes a numeric literal.
    assert not re.search(
        r"(?i)\b[A-Za-z_]*(ratio|tol|guard|thresh|dust|floor)[A-Za-z_]*\s*(:\s*[\w\[\], .]+)?=\s*-?[0-9]",
        _PROBE_SRC,
    )
    # The half-day reading is the one named numeric constant the C5 report may carry.
    assert re.findall(r"^SC4_HALF_DAY_RETURN\s*:\s*float\s*=\s*0\.5$", _PROBE_SRC, re.M)
    assert "PNL_DOM_RATIO" in _PROBE_SRC


# --- the smoothed switch -------------------------------------------------------


@pytest.mark.parametrize("setting", [None, "false"], ids=["unset", "false"])
async def test_a_run_leaves_the_smoothed_switch_and_the_environment_unchanged(
    monkeypatch: Any, setting: str | None
) -> None:
    import os

    if setting is None:
        monkeypatch.delenv("SMOOTHED_MTM_ENABLED", raising=False)
    else:
        monkeypatch.setenv("SMOOTHED_MTM_ENABLED", setting)
    _patch_run_io(monkeypatch, _store(), [], [])
    _install_seam(monkeypatch, _fixture_pair(), [])
    switch_before, env_before = is_smoothed_mtm_enabled(), dict(os.environ)

    assert await probe.run(_STRATEGY_ID) == probe.EXIT_OK

    assert is_smoothed_mtm_enabled() is switch_before is False
    assert dict(os.environ) == env_before


# ---------------------------------------------------------------------------
# Phase 252 plan 07 (gap G252-PROBE-M3): the refusal that fired is named.
#
# Three different smoothed-only refusals used to print the same pair
# (``build-error:LedgerValuationError`` / ``LedgerValuationError:position``), so the
# 2026-11-26 PROD reading of member m3 could not be root-caused. These cases drive the REAL
# smoothed build on a stubbed exchange (the five crawl seams of ``services.deribit_ingest``
# are monkeypatched exactly as ``_run_options_ledger`` does) and pin what the probe prints.
# If they go red the next PROD run reads ``other`` or the base class again and the cause stays
# unmeasurable. The refusals themselves are NOT changed by the plan (founder decision
# 2026-11-26): only their names and closed attributes are new.
# ---------------------------------------------------------------------------

_HOLE_INSTR = "BTC-30JUN23-30000-C"
_HOLE_ROW_IDS = (7301, 7302)
_HOLE_SUMMARIES = [
    {"currency": "BTC", "equity": -0.02, "session_upl": 0.0, "options_value": 0.0}
]
# Held 2023-06-20 .. 2023-06-22, delivered flat on 06-23. Years past, whatever the clock says.
_HOLE_ROWS = [
    _opt_row(
        instrument=_HOLE_INSTR, day="2023-06-20", change=-0.05, position=1.0,
        id=_HOLE_ROW_IDS[0],
    ),
    _opt_row(
        instrument=_HOLE_INSTR, day="2023-06-23", change=0.03, position=0.0,
        id=_HOLE_ROW_IDS[1], type="delivery",
    ),
]
# Marks only from the third held day: the head days 06-20 and 06-21 are missing.
_HEAD_HOLED_CHARTS = {_HOLE_INSTR: {"2023-06-22": 0.02}}


def _patch_real_crawl(monkeypatch: Any, btc_rows: list[dict[str, Any]]) -> None:
    """The five crawl seams of ``services.deribit_ingest``, so the REAL
    ``build_deribit_native_ledger`` runs against ``btc_rows`` with no network."""
    import pandas as pd

    async def _enumerate_scopes(_ex: Any) -> list[Any]:
        return [di.Scope("main", None, True)]

    async def _resolve_scope_auth(_ex: Any, _scope: Any) -> dict[str, Any]:
        return {}

    async def _enumerate_currencies(_ex: Any, _scope: Any, _auth: Any) -> list[str]:
        return ["BTC"]

    async def _paginate(
        _ex: Any, _scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[dict[str, Any]]:
        return list(btc_rows) if currency == "BTC" else []

    async def _index(
        _ex: Any, _ccy: str, *, oldest_day: str, sleep: Any
    ) -> dict[str, float]:
        start = pd.Timestamp(oldest_day).normalize()
        end = max(pd.Timestamp.now("UTC").tz_localize(None).normalize(), start)
        return {d.strftime("%Y-%m-%d"): 60000.0 for d in pd.date_range(start, end, freq="D")}

    monkeypatch.setattr(di, "enumerate_scopes", _enumerate_scopes)
    monkeypatch.setattr(di, "resolve_scope_auth", _resolve_scope_auth)
    monkeypatch.setattr(di, "enumerate_currencies", _enumerate_currencies)
    monkeypatch.setattr(di, "paginate_txn_log", _paginate)
    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _index)


async def _measure_real(
    monkeypatch: Any,
    rows: list[dict[str, Any]],
    charts: dict[str, dict[str, float]],
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """One member through the probe's real ``measure_member_live`` and the real smoothed build.
    Returns the records by basis and every line the emitter prints for them."""
    _patch_real_crawl(monkeypatch, rows)
    records = await probe.measure_member_live(
        _OptionsAdapterStub(_HOLE_SUMMARIES, charts), "m1", None, sleep=_no_sleep
    )
    return {r["basis"]: r for r in records}, [probe.emit_record(r) for r in records]


def _assert_no_row_text_in(
    lines: list[str], row_ids: tuple[int, ...] = _HOLE_ROW_IDS
) -> None:
    """Nothing the real refusal message carries may reach a line: not the instrument, not a day,
    not a row id."""
    for line in lines:
        assert _HOLE_INSTR not in line and "BTC-" not in line
        assert not _DATE_RE.search(line)
        for row_id in row_ids:
            assert str(row_id) not in line


async def test_the_hole_is_real_and_its_message_carries_the_text_the_probe_must_not_print(
    monkeypatch: Any,
) -> None:
    """Control for the redaction assertions below: the REAL refusal on this fixture names the
    instrument and the day. Without this the 'no line carries them' checks could pass because the
    fixture never produced such a message."""
    _patch_real_crawl(monkeypatch, _HOLE_ROWS)
    with pytest.raises(LedgerValuationError) as caught:
        await di.build_deribit_native_ledger(
            _OptionsAdapterStub(_HOLE_SUMMARIES, _HEAD_HOLED_CHARTS),
            None,
            pnl_basis=_SMOOTHED,
        )
    assert _HOLE_INSTR in str(caught.value) and "2023-06-20" in str(caught.value)


async def test_a_retention_straddlers_hole_is_named_by_side_and_retention(
    monkeypatch: Any,
) -> None:
    """The tracer. A head hole older than the hard retention cutoff prints its own class, the
    side of the fetched marks it fell on and ``older``. If this reads ``other`` or the base
    class the PROD reading cannot separate a straddler from a D-09 row; if ``vs_retention``
    reads ``unknown`` the ingest stopped handing down its cutoff."""
    monkeypatch.setenv("DERIBIT_OPTION_MARK_RETENTION_DAYS", "1")
    recs, lines = await _measure_real(monkeypatch, _HOLE_ROWS, _HEAD_HOLED_CHARTS)
    smoothed, cash = recs[_SMOOTHED], recs[_CASH]

    assert smoothed["build"] == "build-error:OptionMarkHoleError"
    assert smoothed["build_error_detail"] == "OptionMarkHoleError:position"
    assert smoothed["refusal_shape"] == {
        "kind": "hole",
        "vs_marks": "before-first-bar",
        "vs_retention": "older",
        "vs_expiry": "not-past-expiry",
    }
    assert smoothed["member_verdict"] == "fail"
    assert (smoothed["c3"], smoothed["c4"]) == ("not-run", "not-run")
    assert cash["refusal_shape"] is None
    _assert_no_row_text_in(lines)


async def test_a_wholly_empty_in_retention_instrument_reads_no_marks_and_not_older(
    monkeypatch: Any,
) -> None:
    """With the horizon set centuries back the wholly-empty instrument is not bucketed to cash,
    so the guard fires on an instrument with no bars at all, and the day is not older than the
    cutoff. A founder reading this needs to know that is a different thing from a straddler."""
    monkeypatch.setenv("DERIBIT_OPTION_MARK_RETENTION_DAYS", "100000")
    recs, lines = await _measure_real(monkeypatch, _HOLE_ROWS, {})
    smoothed, cash = recs[_SMOOTHED], recs[_CASH]

    assert smoothed["build"] == "build-error:OptionMarkHoleError"
    assert smoothed["refusal_shape"] == {
        "kind": "hole",
        "vs_marks": "no-marks",
        "vs_retention": "not-older",
        "vs_expiry": "not-past-expiry",
    }
    assert cash["refusal_shape"] is None
    _assert_no_row_text_in(lines)


async def test_an_off_set_attribute_degrades_to_unreadable_and_the_record_still_prints(
    monkeypatch: Any,
) -> None:
    """Degrade, never refuse (the 252-06 precedent): a hole whose attribute is not a closed word
    prints ``unreadable`` rather than making the emitter refuse the record, so a founder-gated
    PROD run cannot exit 1 for want of a word."""
    from services.deribit_txn import OptionMarkHoleError

    off_set = OptionMarkHoleError(
        "x", vs_marks="2023-06-20", vs_retention="older"
    )
    recs = await _measure(monkeypatch, {**_fixture_pair(), _SMOOTHED: off_set})
    assert recs[_SMOOTHED]["build"] == "build-error:OptionMarkHoleError"
    assert recs[_SMOOTHED]["refusal_shape"] == "unreadable"
    probe.emit_record(recs[_SMOOTHED])


async def test_a_build_that_raises_none_of_the_three_has_a_null_refusal_shape(
    monkeypatch: Any,
) -> None:
    recs = await _measure(
        monkeypatch, {**_fixture_pair(), _SMOOTHED: LedgerValuationError("boom")}
    )
    assert recs[_SMOOTHED]["refusal_shape"] is None
    assert all(r["refusal_shape"] is None for r in (await _measure(monkeypatch, _fixture_pair())).values())


_SIBLINGS = {"trade": 1, "delivery": 0, "assignment": 0, "expiry": 0, "exercise": 1, "other": 0}


@pytest.mark.parametrize(
    "shape",
    [
        {"kind": "burst", "vs_marks": "no-marks", "vs_retention": "older"},  # unknown kind
        {"kind": "hole", "vs_marks": "no-marks", "vs_retention": "older", "day": "x"},  # extra key
        {"kind": "hole", "vs_marks": "2023-06-20", "vs_retention": "older"},  # a date as a word
        {"kind": "hole", "vs_marks": "no-marks", "vs_retention": "tomorrow"},
        {"kind": "hole", "vs_marks": "no-marks"},  # a key short
        {"kind": "exercise", "change": "zero", "position": "absent", "siblings": _SIBLINGS, "x": 1},
        {"kind": "exercise", "change": "0.0", "position": "absent", "siblings": _SIBLINGS},
        {"kind": "expiry", "change": "zero", "position": "BTC-30JUN23-30000-C", "siblings": _SIBLINGS},
        {"kind": "expiry", "change": "zero", "position": "absent", "siblings": {**_SIBLINGS, "BTC-30JUN23-30000-C": 1}},
        {"kind": "expiry", "change": "zero", "position": "absent", "siblings": {"trade": 1}},
        {"kind": "expiry", "change": "zero", "position": "absent", "siblings": {**_SIBLINGS, "trade": -1}},
        {"kind": "expiry", "change": "zero", "position": "absent", "siblings": {**_SIBLINGS, "trade": True}},
        {"kind": "expiry", "change": "zero", "position": "absent", "siblings": {**_SIBLINGS, "trade": 1.0}},
        {"kind": "expiry", "change": "zero", "position": "absent", "siblings": [1, 2]},
        "tomorrow",  # a string other than ``unreadable``
        ["hole"],  # a list
        7,  # a number
    ],
    ids=lambda s: repr(s)[:60],
)
def test_the_emitter_refuses_a_refusal_shape_outside_the_closed_set(shape: Any) -> None:
    """The shape is the one new place free text could enter. Each of these is a way a date,
    an instrument, a row id, a float or an unbounded census could be smuggled through it."""
    probe.emit_record(_honest_record())  # control
    with pytest.raises(ValueError):
        probe.emit_record({**_honest_record(), "refusal_shape": shape})


@pytest.mark.parametrize(
    "shape",
    [
        None,
        "unreadable",
        {"kind": "hole", "vs_marks": "between-bars", "vs_retention": "unknown", "vs_expiry": "unknown"},
        {"kind": "exercise", "change": "zero", "position": "absent", "siblings": _SIBLINGS},
        {"kind": "expiry", "change": "nonzero", "position": "non-numeric", "siblings": _SIBLINGS},
    ],
    ids=lambda s: repr(s)[:40],
)
def test_the_emitter_prints_each_closed_refusal_shape(shape: Any) -> None:
    line = probe.emit_record({**_honest_record(), "refusal_shape": shape})
    assert json.loads(line)["refusal_shape"] == shape


# --- plan 07: the two D-09 row refusals, through the real smoothed build --------

_ROW_INSTR = "BTC-17JAN26-50000-P"
_ROW_IDS = (7401, 7402, 7403)
_ROW_SIBLING_ZERO = {"trade": 0, "delivery": 0, "assignment": 0, "expiry": 0, "exercise": 0, "other": 0}


def _d09_rows(close_type: str, **overrides: Any) -> list[dict[str, Any]]:
    """A long put opened on 01-15, then a zero-cash ``close_type`` row on 01-17. Both pass the
    cash twins, so only the smoothed replay can refuse them."""
    opening = _opt_row(
        instrument=_ROW_INSTR, day="2026-01-15", change=-0.04, position=1.0, id=_ROW_IDS[0]
    )
    closing: dict[str, Any] = {
        "type": close_type,
        "instrument_name": _ROW_INSTR,
        "currency": "BTC",
        "change": 0.0,
        "timestamp": _mk_ms("2026-01-17", 8),
        "id": _ROW_IDS[1],
    }
    closing.update(overrides)
    return [opening, closing]


_D09_SUMMARIES = [{"currency": "BTC", "equity": -0.04, "session_upl": 0.0, "options_value": 0.0}]


async def _measure_d09(
    monkeypatch: Any, rows: list[dict[str, Any]]
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    _patch_real_crawl(monkeypatch, rows)
    stub = _OptionsAdapterStub(_D09_SUMMARIES, {})
    records = await probe.measure_member_live(stub, "m1", None, sleep=_no_sleep)
    return {r["basis"]: r for r in records}, [probe.emit_record(r) for r in records]


async def test_an_exercise_ledger_reads_its_own_class_and_the_row_shape(
    monkeypatch: Any,
) -> None:
    """The exercise refusal fires before any mark is fetched. The record names it and prints the
    refusing row's change and position shape and the same-instrument type census, and the real
    message (instrument, id) reaches no line. Red means a PROD reading cannot tell an
    unmeasured exercise row from a retention hole."""
    recs, lines = await _measure_d09(monkeypatch, _d09_rows("exercise"))
    smoothed, cash = recs[_SMOOTHED], recs[_CASH]
    assert smoothed["build"] == "build-error:OptionExerciseRowError"
    assert smoothed["build_error_detail"] == "OptionExerciseRowError:position"
    assert smoothed["refusal_shape"] == {
        "kind": "exercise",
        "change": "zero",
        "position": "absent",
        "siblings": {**_ROW_SIBLING_ZERO, "trade": 1, "exercise": 1},
    }
    assert smoothed["member_verdict"] == "fail"
    assert cash["refusal_shape"] is None
    _assert_no_row_text_in(lines, _ROW_IDS)


async def test_an_expiry_with_a_position_reads_its_own_class_and_the_row_shape(
    monkeypatch: Any,
) -> None:
    recs, lines = await _measure_d09(monkeypatch, _d09_rows("expiry", position=-1.0))
    smoothed = recs[_SMOOTHED]
    assert smoothed["build"] == "build-error:OptionExpiryRowError"
    assert smoothed["build_error_detail"] == "OptionExpiryRowError:position"
    assert smoothed["refusal_shape"] == {
        "kind": "expiry",
        "change": "zero",
        "position": "nonzero",
        "siblings": {**_ROW_SIBLING_ZERO, "trade": 1, "expiry": 1},
    }
    assert recs[_CASH]["refusal_shape"] is None
    _assert_no_row_text_in(lines, _ROW_IDS)


@pytest.mark.parametrize("cls", [OptionExerciseRowError, OptionExpiryRowError])
@pytest.mark.parametrize(
    "attrs",
    [
        {"change_shape": "2023-06-20", "position_shape": "absent", "siblings": _ROW_SIBLING_ZERO},
        {"change_shape": "zero", "position_shape": ["absent"], "siblings": _ROW_SIBLING_ZERO},
        {"change_shape": "zero", "position_shape": "absent", "siblings": {"trade": 1}},
        {"change_shape": "zero", "position_shape": "absent", "siblings": {**_ROW_SIBLING_ZERO, "trade": True}},
        {"change_shape": "zero", "position_shape": "absent", "siblings": {**_ROW_SIBLING_ZERO, "trade": -1}},
        {"change_shape": "zero", "position_shape": "absent", "siblings": {**_ROW_SIBLING_ZERO, "trade": 1.0}},
    ],
    ids=["date-word", "unhashable-word", "short-census", "bool-count", "negative-count", "float-count"],
)
async def test_an_off_set_row_attribute_degrades_to_unreadable_and_still_prints(
    monkeypatch: Any, cls: Any, attrs: dict[str, Any]
) -> None:
    """Degrade, never refuse: whatever is wrong with an attribute, the record prints as
    ``unreadable`` (a float count would otherwise make the emitter refuse the whole record)."""
    recs = await _measure(monkeypatch, {**_fixture_pair(), _SMOOTHED: cls("x", **attrs)})
    assert recs[_SMOOTHED]["refusal_shape"] == "unreadable"
    probe.emit_record(recs[_SMOOTHED])


# --- plan 07 round 1 (SFH LOW-4): the hole shape carries ``vs_expiry`` --------------------


@pytest.mark.parametrize("word", ["past-expiry", "not-past-expiry", "unknown"])
def test_the_hole_shape_builder_carries_each_vs_expiry_word(word: str) -> None:
    from services.deribit_txn import OptionMarkHoleError

    exc = OptionMarkHoleError(
        "x", vs_marks="after-last-bar", vs_retention="not-older", vs_expiry=word
    )
    shape = probe._refusal_shape(exc)
    assert shape == {
        "kind": "hole",
        "vs_marks": "after-last-bar",
        "vs_retention": "not-older",
        "vs_expiry": word,
    }
    assert json.loads(probe.emit_record({**_honest_record(), "refusal_shape": shape}))[
        "refusal_shape"
    ] == shape


def test_an_off_set_vs_expiry_degrades_to_unreadable() -> None:
    from services.deribit_txn import OptionMarkHoleError

    exc = OptionMarkHoleError(
        "x", vs_marks="after-last-bar", vs_retention="older", vs_expiry="2023-06-30"
    )
    assert probe._refusal_shape(exc) == "unreadable"


@pytest.mark.parametrize(
    "vs_expiry", ["tomorrow", "2023-06-30", "", None, 7, ["past-expiry"]], ids=repr
)
def test_the_emitter_refuses_a_vs_expiry_outside_the_closed_set(vs_expiry: Any) -> None:
    shape = {
        "kind": "hole",
        "vs_marks": "after-last-bar",
        "vs_retention": "older",
        "vs_expiry": vs_expiry,
    }
    with pytest.raises(ValueError):
        probe.emit_record({**_honest_record(), "refusal_shape": shape})
