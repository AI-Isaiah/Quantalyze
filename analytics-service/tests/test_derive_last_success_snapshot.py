"""Phase 190 FACTSHEETQUEUED plan 09 - the derive prestamp carries the last success's flags.

WHY THIS FILE EXISTS (D-02, SC-3, SC-6). A single-key broker re-run's derive hop REPLACES
``strategy_analytics.data_quality_flags`` wholesale (MED-3) minutes before the compute hop's
success write. The factsheet reads the stored numbers beside the flags that describe them
(``cumulative_method`` above all). Without a copy of the last success's flags, the prestamp
erases them and the factsheet of a strategy that is merely being RE-computed disappears
until the success write. The snapshot is that copy, bound to the row's ``computed_at`` so a
reader can tell it belongs to the numbers on the row.

Neuter-falsifiability (test -> mutation it kills):
  * the helper truth table - kills a helper that returns None unconditionally, one that
    nests the snapshot, one that shares mutable state with the read row, and one that
    snapshots flags without the marker.
  * ``test_prestamp_carries_the_snapshot_*`` - kills dropping the assignment, and kills
    guarding it on "a snapshot exists" (D-04 needs the key present with a null value so a
    prestamp that left no snapshot is told apart from a legacy row at rest).
  * ``test_a_failing_read_*`` - kills letting the display-only read fail the derive.
"""
from __future__ import annotations

import copy
import logging
from typing import Any

import pytest
from unittest.mock import MagicMock, patch

from services.job_worker import (
    LAST_SUCCESS_SNAPSHOT_KEY,
    DispatchOutcome,
    _last_success_snapshot,
    run_derive_broker_dailies_job,
)
from tests._schema_columns import assert_select_columns
from tests.test_mtm_single_key import (
    _STRATEGY_ID,
    _apply,
    _base_patches,
    _cash_series,
    _ctx,
    _find_prestamp,
    _ledger_meta,
    _recording_ledger,
    _report,
)

_COMPUTED_AT = "2026-11-01T10:00:00.123456+00:00"
_MARKED_FLAGS: dict[str, Any] = {
    "csv_source": True,
    "cumulative_method": "geometric",
    "native_unit": "BTC",
    "headline_since": "2026-01-05",
}
_SELECT = "data_quality_flags, computed_at"


# ── the pure helper ─────────────────────────────────────────────────────────


def test_marker_bearing_flags_are_snapshotted_with_their_computed_at() -> None:
    """WHY: the marker is what proves the flags were written by a success, and the
    snapshot must hold exactly what the row held so the figures and flags shown together
    come from one run."""
    out = _last_success_snapshot(
        {"data_quality_flags": copy.deepcopy(_MARKED_FLAGS), "computed_at": _COMPUTED_AT}
    )
    assert out == {"computed_at": _COMPUTED_AT, "flags": _MARKED_FLAGS}


def test_a_well_formed_snapshot_is_carried_forward_unchanged() -> None:
    """WHY: a retried derive (or a new chain after a failure arm that replaced the flags)
    finds no marker but the previous derive's snapshot; dropping it would erase the only
    copy of the flags that go with the stored numbers."""
    snap = {"computed_at": _COMPUTED_AT, "flags": copy.deepcopy(_MARKED_FLAGS)}
    row = {
        "data_quality_flags": {"csv_source": True, LAST_SUCCESS_SNAPSHOT_KEY: snap},
        "computed_at": "2026-11-02T00:00:00+00:00",
    }
    assert _last_success_snapshot(row) == snap


def test_the_snapshot_never_nests() -> None:
    """WHY: marker flags carrying a stale nested snapshot must not copy it, or each derive
    would wrap the previous one and the column would grow without bound."""
    stale = {"computed_at": "2026-10-01T00:00:00+00:00", "flags": copy.deepcopy(_MARKED_FLAGS)}
    flags = {**_MARKED_FLAGS, LAST_SUCCESS_SNAPSHOT_KEY: stale}
    out = _last_success_snapshot({"data_quality_flags": flags, "computed_at": _COMPUTED_AT})
    assert out is not None
    assert out["computed_at"] == _COMPUTED_AT
    assert LAST_SUCCESS_SNAPSHOT_KEY not in out["flags"]
    assert out["flags"] == _MARKED_FLAGS


@pytest.mark.parametrize(
    "row",
    [
        pytest.param(
            {"data_quality_flags": {"csv_source": True}, "computed_at": _COMPUTED_AT},
            id="no-marker-no-snapshot",
        ),
        pytest.param({"data_quality_flags": None, "computed_at": _COMPUTED_AT}, id="flags-null"),
        pytest.param({"data_quality_flags": [], "computed_at": _COMPUTED_AT}, id="flags-list"),
        pytest.param({"data_quality_flags": "x", "computed_at": _COMPUTED_AT}, id="flags-string"),
        pytest.param({"data_quality_flags": dict(_MARKED_FLAGS)}, id="computed-at-missing"),
        pytest.param(
            {"data_quality_flags": dict(_MARKED_FLAGS), "computed_at": None},
            id="computed-at-null",
        ),
        pytest.param(
            {"data_quality_flags": dict(_MARKED_FLAGS), "computed_at": 1730000000},
            id="computed-at-not-a-string",
        ),
        pytest.param(
            {"data_quality_flags": dict(_MARKED_FLAGS), "computed_at": ""},
            id="computed-at-empty",
        ),
        pytest.param(
            {
                "data_quality_flags": {**_MARKED_FLAGS, "cumulative_method": ""},
                "computed_at": _COMPUTED_AT,
            },
            id="marker-empty",
        ),
        pytest.param(
            {
                "data_quality_flags": {**_MARKED_FLAGS, "cumulative_method": 3},
                "computed_at": _COMPUTED_AT,
            },
            id="marker-not-a-string",
        ),
        pytest.param(
            {
                "data_quality_flags": {"csv_source": True, LAST_SUCCESS_SNAPSHOT_KEY: None},
                "computed_at": _COMPUTED_AT,
            },
            id="snapshot-null",
        ),
        pytest.param(
            {
                "data_quality_flags": {
                    "csv_source": True,
                    LAST_SUCCESS_SNAPSHOT_KEY: {"flags": dict(_MARKED_FLAGS)},
                },
                "computed_at": _COMPUTED_AT,
            },
            id="snapshot-no-computed-at",
        ),
        pytest.param(
            {
                "data_quality_flags": {
                    "csv_source": True,
                    LAST_SUCCESS_SNAPSHOT_KEY: {"computed_at": _COMPUTED_AT, "flags": "x"},
                },
                "computed_at": _COMPUTED_AT,
            },
            id="snapshot-flags-not-an-object",
        ),
        pytest.param(
            {
                "data_quality_flags": {
                    "csv_source": True,
                    LAST_SUCCESS_SNAPSHOT_KEY: {
                        "computed_at": _COMPUTED_AT,
                        "flags": {"csv_source": True},
                    },
                },
                "computed_at": _COMPUTED_AT,
            },
            id="snapshot-flags-without-marker",
        ),
        pytest.param(None, id="row-none"),
        pytest.param(MagicMock(), id="row-magicmock"),
        pytest.param("not a row", id="row-string"),
    ],
)
def test_nothing_usable_returns_none_and_never_invents_a_snapshot(row: object) -> None:
    """WHY: a snapshot made up from flags that no success wrote would show a factsheet
    flags that do not describe its numbers (SC-6). None is the safe answer; the reader
    then withholds the window, which is the fail-closed direction."""
    assert _last_success_snapshot(row) is None


def test_the_snapshot_shares_no_mutable_state_with_the_read_row() -> None:
    """WHY: the read row is a live dict. A later mutation of it must not reach into a
    payload that has already been built for the upsert."""
    row = {"data_quality_flags": copy.deepcopy(_MARKED_FLAGS), "computed_at": _COMPUTED_AT}
    row["data_quality_flags"]["headline_dates"] = ["2026-01-05"]
    out = _last_success_snapshot(row)
    assert out is not None
    row["data_quality_flags"]["headline_dates"].append("2026-01-06")
    row["data_quality_flags"]["csv_source"] = False
    assert out["flags"]["headline_dates"] == ["2026-01-05"]
    assert out["flags"]["csv_source"] is True

    snap = {"computed_at": _COMPUTED_AT, "flags": copy.deepcopy(_MARKED_FLAGS)}
    row2 = {"data_quality_flags": {LAST_SUCCESS_SNAPSHOT_KEY: snap}, "computed_at": "x"}
    carried = _last_success_snapshot(row2)
    assert carried is not None
    snap["flags"]["csv_source"] = False
    assert carried["flags"]["csv_source"] is True


# ── the derive hop ──────────────────────────────────────────────────────────


def _with_strategy_analytics_read(
    ctx: MagicMock, capture: dict, outcome: object
) -> None:
    """Make ``strategy_analytics.select(...)...maybe_single().execute()`` answer with
    ``outcome``: a row dict, None (no row), or an exception to raise."""
    capture.setdefault("selects", [])
    original = ctx.supabase.table.side_effect

    def _table(name: str) -> MagicMock:
        tbl = original(name)
        if name == "strategy_analytics":

            def _select(cols: str, **_kw: object) -> MagicMock:
                capture["selects"].append(cols)
                chain = MagicMock()
                chain.eq.return_value = chain
                chain.maybe_single.return_value = chain
                if isinstance(outcome, BaseException):
                    chain.execute.side_effect = outcome
                else:
                    chain.execute.return_value = MagicMock(data=outcome)
                return chain

            tbl.select.side_effect = _select
        return tbl

    ctx.supabase.table.side_effect = _table


async def _derive_prestamp(outcome: object) -> tuple[dict[str, Any], dict, Any]:
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    _with_strategy_analytics_read(ctx, capture, outcome)
    ledger_mock, _calls = _recording_ledger([_report(has_option_activity=False)])
    combine = MagicMock(return_value=(_cash_series(), _ledger_meta()))
    with _apply(
        _base_patches(ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine)
    ):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    prestamp = _find_prestamp(capture)
    assert prestamp is not None, "the derive must still upsert its prestamp"
    return prestamp, capture, result


@pytest.mark.asyncio
async def test_prestamp_carries_the_snapshot_of_the_last_success() -> None:
    """WHY (D-02, SC-3): the stored numbers stay on screen through a re-run only if the
    flags that go with them survive the prestamp that replaces the column."""
    row = {"data_quality_flags": copy.deepcopy(_MARKED_FLAGS), "computed_at": _COMPUTED_AT}
    prestamp, capture, result = await _derive_prestamp(row)
    assert result.outcome == DispatchOutcome.DONE
    flags = prestamp["data_quality_flags"]
    assert flags[LAST_SUCCESS_SNAPSHOT_KEY] == {
        "computed_at": _COMPUTED_AT,
        "flags": _MARKED_FLAGS,
    }
    assert any(s == _SELECT for s in capture["selects"])


@pytest.mark.asyncio
async def test_prestamp_carries_the_key_as_null_when_there_is_no_row() -> None:
    """WHY (D-04): a prestamp that left no usable snapshot must still carry the key, null
    valued, so a terminal-success row in that state is told apart from a legacy row at
    rest (which carries no key) and withheld. Also pins that the snapshot is the ONLY
    thing this plan added to the flags."""
    row = {"data_quality_flags": copy.deepcopy(_MARKED_FLAGS), "computed_at": _COMPUTED_AT}
    with_row, _, _ = await _derive_prestamp(row)
    no_row, _, _ = await _derive_prestamp(None)

    assert LAST_SUCCESS_SNAPSHOT_KEY in no_row["data_quality_flags"]
    assert no_row["data_quality_flags"][LAST_SUCCESS_SNAPSHOT_KEY] is None
    stripped_a = {
        k: v for k, v in with_row["data_quality_flags"].items() if k != LAST_SUCCESS_SNAPSHOT_KEY
    }
    stripped_b = {
        k: v for k, v in no_row["data_quality_flags"].items() if k != LAST_SUCCESS_SNAPSHOT_KEY
    }
    assert stripped_a == stripped_b, "the snapshot must be the only difference"
    assert set(with_row) == set(no_row)


@pytest.mark.asyncio
async def test_a_legacy_row_without_marker_or_snapshot_gets_a_null_key() -> None:
    """WHY (D-04): a row computed before the marker existed has nothing worth copying.
    The prestamp must say so with a null-valued key, never invent a snapshot."""
    row = {"data_quality_flags": {"csv_source": True}, "computed_at": _COMPUTED_AT}
    prestamp, _, _ = await _derive_prestamp(row)
    flags = prestamp["data_quality_flags"]
    assert LAST_SUCCESS_SNAPSHOT_KEY in flags
    assert flags[LAST_SUCCESS_SNAPSHOT_KEY] is None


async def _derive_with_failing_read(outcome: BaseException) -> tuple[dict, bool]:
    """Run the derive with the snapshot read failing. Returns (capture, prestamp_written)."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    _with_strategy_analytics_read(ctx, capture, outcome)
    ledger_mock, _calls = _recording_ledger([_report(has_option_activity=False)])
    combine = MagicMock(return_value=(_cash_series(), _ledger_meta()))
    with _apply(
        _base_patches(ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine)
    ):
        with pytest.raises(type(outcome)):
            await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    return capture, _find_prestamp(capture) is not None


@pytest.mark.asyncio
async def test_a_failing_read_fails_the_job_and_writes_no_prestamp(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """WHY (review round 1, SFH MEDIUM-1): the prestamp replaces data_quality_flags
    wholesale. Writing it with a null snapshot after a failed read destroyed the snapshot a
    previous attempt had carried (a retry) and silently reverted to the hidden-factsheet
    behaviour. A failed read must fail the job BEFORE the prestamp, so the queue retries it
    and the carried snapshot survives."""
    caplog.set_level(logging.WARNING, logger="quantalyze.analytics.job_worker")
    with patch("services.job_worker._capture_read_failure") as capture_exc:
        capture, prestamp_written = await _derive_with_failing_read(RuntimeError("pg blip"))
    assert not prestamp_written, "no prestamp may be written over a snapshot that was not read"
    assert not any(rpc == "enqueue_compute_job" for rpc, _ in capture["rpc_calls"]), (
        "no compute hop may be enqueued behind a derive that failed"
    )
    records = [r for r in caplog.records if _STRATEGY_ID in r.getMessage()]
    assert any(r.levelno == logging.WARNING for r in records)
    assert not any(r.levelno >= logging.ERROR for r in records)
    capture_exc.assert_called_once()


@pytest.mark.asyncio
async def test_a_failing_read_writes_no_series_row() -> None:
    """WHY (review round 2, SFH M1): the read used to sit after the three series persists, so
    a persistently failing read left fresh MTM / cash / smoothed series rows beside the old
    scalars the prestamp never replaced. The read now precedes every series write, so a failure
    aborts before any series row is rewritten or healed."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    _with_strategy_analytics_read(ctx, capture, RuntimeError("pg blip"))
    ledger_mock, _calls = _recording_ledger([_report(has_option_activity=False)])
    combine = MagicMock(return_value=(_cash_series(), _ledger_meta()))
    persist = MagicMock()
    with _apply(
        _base_patches(ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine)
    ), patch("services.basis_series.persist_basis_series", new=persist), patch(
        "services.job_worker._capture_read_failure"
    ):
        with pytest.raises(RuntimeError):
            await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    persist.assert_not_called()
    assert not any(
        rpc == "upsert_strategy_analytics_series_batch" for rpc, _ in capture["rpc_calls"]
    )


@pytest.mark.asyncio
async def test_a_failing_read_that_is_a_programming_error_logs_error_and_propagates(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """WHY: a TypeError in the read is a bug in this code, not a database answer. It is
    labelled ERROR so it is not read as "the database was busy", and it propagates as
    itself rather than silently hiding every factsheet behind a null snapshot."""
    caplog.set_level(logging.WARNING, logger="quantalyze.analytics.job_worker")
    with patch("services.job_worker._capture_read_failure") as capture_exc:
        _, prestamp_written = await _derive_with_failing_read(TypeError("bad shape"))
    assert not prestamp_written
    records = [r for r in caplog.records if _STRATEGY_ID in r.getMessage()]
    assert any(r.levelno == logging.ERROR for r in records)
    capture_exc.assert_called_once()


@pytest.mark.asyncio
async def test_the_read_selects_only_columns_the_table_has() -> None:
    """WHY: a select naming a column the table lacks is a PostgREST 400 that the guarded
    read would swallow, silently dropping every snapshot."""
    row = {"data_quality_flags": copy.deepcopy(_MARKED_FLAGS), "computed_at": _COMPUTED_AT}
    _, capture, _ = await _derive_prestamp(row)
    reads = [s for s in capture["selects"] if "computed_at" in s]
    assert reads, "the derive must read computed_at beside the flags"
    for sel in reads:
        assert_select_columns("strategy_analytics", sel)
