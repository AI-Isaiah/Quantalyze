"""Phase 259 plan 07: the ``fills_apply`` write, the only code in the phase that writes to PROD
``trades``.

What these tests protect, in one paragraph (Rule 9): a ``fills_apply`` job stores OKX archive fills
as trade history that every fills-based reader then trusts. So every row it writes must be the row
``fills-history`` would have stored (same upsert, same conflict key, same values), a rerun must store
NOTHING new (the unique index is the arbiter), and a failed gate must store nothing at all, for ANY
target: a bal-chain break, a mapping stop, a reconcile miss on one target, or a stored row the
archive contradicts or lacks (``fills_legacy_mismatch``, the same predicate the runbook applies to a
calibrate, so the automatic chain can never write what the runbook would refuse). A batch that fails
midway is a named, counted, transient stop that resumes idempotently, and nothing here ever moves the
fills cursor. "Nothing was written" is asserted on the fake's upsert recorder, never on log text.

The fakes record every upsert with the options it was called with and emulate the
``trades_dedup_fill`` unique index with both PostgREST answers, so a write that loses
``ignore_duplicates`` reads a non-zero ``inserted`` on a rerun.
"""
from __future__ import annotations

import csv
import inspect
import io
import re
from collections.abc import Sequence
from datetime import date
from typing import Any

import pytest

from services import exchange as exchange_module
from services import job_worker, okx_archive_fills, okx_archive_fills_chain, okx_archive_fills_map
from services import okx_archive_job
from services.job_worker import DispatchOutcome, dispatch
from tests import _okx_archive_fills_fakes as fk
from tests import _okx_archive_fills_fixtures as fx
from tests._okx_archive_fills_fakes import STRATEGY_2_ID, STRATEGY_ID, World

TODAY_DATE = date(2026, 11, 27)
#: 2026-12-31T12:00Z: the write bound (2026-10-02T12:00Z) lies inside the current, unfinished Q4.
LATE_NOW_MS = 1798718400000
LATE_TODAY = date(2026, 12, 31)
LIVE_UPSERT = {
    "on_conflict": "strategy_id,exchange,exchange_fill_id",
    "ignore_duplicates": True,
}
CURSOR_RPCS = ("advance_sync_cursor", "set_strategy_fills_reread_bound")


@pytest.fixture(autouse=True)
def _no_raw_data(monkeypatch: pytest.MonkeyPatch) -> None:
    """The stored rows carry the trimmed ``raw_data`` the fixtures' oracle spells out."""
    monkeypatch.setattr(exchange_module, "_STORE_FULL_RAW_DATA", False)


def _s1_trades(ids: Sequence[str] = (*fx.TRADE_IDS_RECONCILE_WINDOW, fx.TRADE_IDS_WRITE_WINDOW[0])) -> list[dict[str, Any]]:
    return [fx.stored_row(t, strategy_id=STRATEGY_ID) for t in ids]


def _s2_trades(ids: Sequence[str] = fx.TRADE_IDS_RECONCILE_WINDOW) -> list[dict[str, Any]]:
    return [fx.stored_row(t, strategy_id=STRATEGY_2_ID) for t in ids]


def _install(
    monkeypatch: pytest.MonkeyPatch,
    *,
    two_targets: bool = True,
    s1_trades: list[dict[str, Any]] | None = None,
    s2_trades: list[dict[str, Any]] | None = None,
    anchors: tuple[str, str] = (fx.ANCHOR_DAY, fx.ANCHOR_DAY),
    now_ms: int = fx.NOW_MS,
    today: date = TODAY_DATE,
) -> World:
    """One OKX account U1. S1 on K1 (the job's key) and, with ``two_targets``, S2 on K2: both
    anchored on ``anchors``, with the stored fills given (default: the reconcile window of both and
    one write-window fill of S1)."""
    keys = [fk.key()]
    strategies = [fk.strategy()]
    daily = [{"strategy_id": STRATEGY_ID, "date": anchors[0]}]
    trades = list(_s1_trades() if s1_trades is None else s1_trades)
    if two_targets:
        keys.append(fk.key(fk.OTHER_KEY_ID))
        strategies.append(fk.strategy(STRATEGY_2_ID, fk.OTHER_KEY_ID))
        daily.append({"strategy_id": STRATEGY_2_ID, "date": anchors[1]})
        trades += _s2_trades() if s2_trades is None else s2_trades
    return fk.install(
        monkeypatch,
        keys=keys,
        strategies=strategies,
        daily_returns=daily,
        trades=trades,
        now_ms=now_ms,
        today=today,
    )


def _upserts(world: World) -> list[dict[str, Any]]:
    assert world.supabase is not None
    return world.supabase.upserts_to("trades")


def _sent(world: World) -> dict[str, list[dict[str, Any]]]:
    """Every row the job sent, grouped by the strategy it was sent for, in send order."""
    out: dict[str, list[dict[str, Any]]] = {}
    for call in _upserts(world):
        for row in call["rows"]:
            out.setdefault(row["strategy_id"], []).append(row)
    return out


def _without_docstring(source: str) -> str:
    """A function's source with its first triple-quoted block (the docstring) removed."""
    return re.sub(r'""".*?"""', "", source, count=1, flags=re.S)


def _fill_ids(rows: Sequence[dict[str, Any]]) -> list[str]:
    return [row["exchange_fill_id"] for row in rows]


def _csv_edit(data: bytes, bill_id: str, **cells: str) -> bytes:
    """A copy of an archive CSV with some cells of one bill replaced (named by header column)."""
    reader = list(csv.reader(io.StringIO(data.decode())))
    header = reader[0]
    hit = [row for row in reader[1:] if row[header.index("billId")] == bill_id]
    assert len(hit) == 1, f"bill {bill_id} not found exactly once"
    for name, value in cells.items():
        hit[0][header.index(name)] = value
    out = io.StringIO()
    csv.writer(out, lineterminator="\n").writerows(reader)
    return out.getvalue().encode()


def _q3_with_extra_trade_bills(extra: int) -> bytes:
    """The Q3 fixture with ``extra`` more zero-effect trade bills in its write window (2026-08-20),
    ids from ranges the fixtures do not use. Every original billId is multiplied by 1000 so the new
    bills sort BETWEEN billIds 910000011 and 910000012 (the chain runs in billId order); a zero
    ``balChg`` keeps every ``bal`` as it was, so the chain still holds."""
    reader = list(csv.reader(io.StringIO(fx.FILLS_Q3_PATH.read_text())))
    header = reader[0]
    col = header.index
    body = reader[1:]
    for row in body:
        row[col("billId")] = str(int(row[col("billId")]) * 1000)
    anchor_bill = "910000011000"
    template = next(r for r in body if r[col("subType")] == "1")
    new_rows: list[list[str]] = []
    for k in range(1, extra + 1):
        row = list(template)
        ts = 1787184000000 + k * 1000 + 123
        row[col("billId")] = str(int(anchor_bill) + k)
        row[col("ts")] = str(ts)
        row[col("balChg")] = "0"
        row[col("bal")] = "5060.11"
        row[col("sz")] = "1"
        row[col("px")] = "3000.5"
        row[col("pnl")] = "0"
        row[col("fee")] = "0"
        row[col("ordId")] = str(770100000 + k)
        row[col("fillTime")] = str(ts - 1)
        row[col("tradeId")] = str(880100000 + k)
        new_rows.append(row)
    out = io.StringIO()
    csv.writer(out, lineterminator="\n").writerows([header, *body, *new_rows])
    return out.getvalue().encode()


# ---------------------------------------------------------------------------
# Task 1 (tracer): the write, the rerun, the cursor, the dry run
# ---------------------------------------------------------------------------

class TestWrite:
    @pytest.mark.asyncio
    async def test_apply_writes_every_window_fill_once(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Why this matters: this is the one write to PROD ``trades``. Each target gets exactly the
        archive fills in [anchor, write bound), through the live upsert's own literals, each equal
        to the hand-typed row plus the strategy id; the fill before the anchor and the reconcile
        window (which fills-history already owns) are never sent."""
        world = _install(monkeypatch)

        outcome = await dispatch(fk.job({"mode": "fills_apply"}))

        assert outcome.outcome == DispatchOutcome.DONE
        calls = _upserts(world)
        assert calls, "a fills_apply with window fills must write"
        for call in calls:
            assert call["on_conflict"] == LIVE_UPSERT["on_conflict"]
            assert call["ignore_duplicates"] is True
        sent = _sent(world)
        assert set(sent) == {STRATEGY_ID, STRATEGY_2_ID}
        for strategy_id, rows in sent.items():
            assert sorted(_fill_ids(rows)) == sorted(fx.TRADE_IDS_WRITE_WINDOW)
            for row in rows:
                assert row == {"strategy_id": strategy_id, **fx.EXPECTED_ROWS[row["exchange_fill_id"]]}
            for excluded in (*fx.TRADE_IDS_BEFORE_ANCHOR, *fx.TRADE_IDS_RECONCILE_WINDOW):
                assert excluded not in _fill_ids(rows)
        result = world.result()
        first, second = result["strategies"]
        assert first["inserted"] == len(fx.TRADE_IDS_WRITE_WINDOW) - 1  # one was already stored
        assert second["inserted"] == len(fx.TRADE_IDS_WRITE_WINDOW)
        assert result["info"]["outcome"] == "applied"
        assert result["stop_class"] is None
        inserted_rows = [row for call in calls for row in call["returned"]]
        assert len(inserted_rows) == first["inserted"] + second["inserted"]
        for row in inserted_rows:
            assert row["raw_data"]["source"] == "okx_bills_history_archive"

    @pytest.mark.asyncio
    async def test_apply_second_run_inserts_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Why this matters: the chain re-runs the job and an operator may re-run it, so a second
        run over the same world must store nothing new. The rows the first run stored are also read
        back by the second run's legacy reading and must be equal by value (a rerun that tripped
        ``fills_legacy_mismatch`` on its own rows would be a permanent stop)."""
        world = _install(monkeypatch)
        job = fk.job({"mode": "fills_apply"})

        first = await dispatch(job)
        assert first.outcome == DispatchOutcome.DONE
        assert world.supabase is not None
        before = len(world.supabase.tables["trades"])
        second = await dispatch(job)

        assert second.outcome == DispatchOutcome.DONE, second.error_message
        result = world.last_result()
        assert [s["inserted"] for s in result["strategies"]] == [0, 0]
        assert len(world.supabase.tables["trades"]) == before
        assert all(not call["returned"] for call in _upserts(world)[-2:]), "the rerun's upserts returned rows"
        assert [s["legacy"]["matched"] for s in result["strategies"]] == [
            len(fx.TRADE_IDS_WRITE_WINDOW)
        ] * 2

    @pytest.mark.asyncio
    async def test_apply_never_moves_the_fills_cursor(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Why this matters: the fills cursor belongs to ``run_sync_trades_job``. An archive job that
        advanced it would make the live sync skip fills-history windows it still has to read."""
        world = _install(monkeypatch)
        job = fk.job({"mode": "fills_apply"})

        await dispatch(job)
        await dispatch(job)

        assert world.supabase is not None
        names = [name for name, _ in world.supabase.rpcs]
        assert "set_compute_job_progress" in names
        for forbidden in CURSOR_RPCS:
            assert forbidden not in names

    @pytest.mark.asyncio
    async def test_calibrate_never_writes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Why this matters: the dry run is the only look at the real trade cells before a write,
        and the apply POST is budgeted at a dozen a day. A calibrate that wrote would not be one.
        It also reports ``would_insert`` equal to what the apply then inserts."""
        calibrate_world = _install(monkeypatch)
        calibrated = await dispatch(fk.job({"mode": "fills_calibrate"}))
        assert calibrated.outcome == DispatchOutcome.DONE
        assert _upserts(calibrate_world) == []
        would = [s["would_insert"] for s in calibrate_world.result()["strategies"]]
        assert all(s["inserted"] is None for s in calibrate_world.result()["strategies"])

        apply_world = _install(monkeypatch)
        applied = await dispatch(fk.job({"mode": "fills_apply"}))
        assert applied.outcome == DispatchOutcome.DONE
        assert [s["inserted"] for s in apply_world.result()["strategies"]] == would


# ---------------------------------------------------------------------------
# Task 2: all or nothing on every gate
# ---------------------------------------------------------------------------

def _q3_world(monkeypatch: pytest.MonkeyPatch, q3: bytes) -> World:
    world = _install(monkeypatch)
    world.csv_by_quarter["2026Q3"] = q3
    return world


class TestAllOrNothing:
    @pytest.mark.asyncio
    async def test_bal_chain_break_writes_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Why this matters: a Q3 whose first ``bal`` no longer continues Q2's last one is a file with
        a bill missing at the seam; its fills would be stored as complete history."""
        data = fx.FILLS_Q3_PATH.read_bytes()
        assert fx.QUARTER_BALANCES["q3_first_bal"].encode() in data
        world = _q3_world(
            monkeypatch,
            _csv_edit(data, "910000008", bal="5033.99"),
        )

        outcome = await dispatch(fk.job({"mode": "fills_apply"}))

        assert outcome.outcome == DispatchOutcome.FAILED
        result = world.result()
        assert result["stop_class"] == "archive_incomplete"
        assert result["info"]["bal_chain"]["reason"] == "bal_chain_break"
        assert _upserts(world) == []

    @pytest.mark.asyncio
    async def test_parse_stop_writes_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Why this matters: a drifted header means the columns are no longer the proven ones."""
        data = fx.FILLS_Q3_PATH.read_bytes()
        world = _q3_world(monkeypatch, data.replace(b"posBalChg", b"posBalChgX", 1))

        outcome = await dispatch(fk.job({"mode": "fills_apply"}))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert world.result()["stop_class"] == "header_drift"
        assert _upserts(world) == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("stop_class", "edit"),
        [
            pytest.param("unproven_inst_type", {"instType": "SPOT"}, id="unproven_inst_type"),
            pytest.param("unknown_contract_size", {"instId": "PEPE-USDT-SWAP"}, id="unknown_contract_size"),
            pytest.param("duplicate_trade_id", {"tradeId": "880000005"}, id="duplicate_trade_id"),
            pytest.param("unmapped_trade_subtype", {"subType": "104"}, id="unmapped_trade_subtype"),
            pytest.param("unreadable_trade_bill", {"tradeId": ""}, id="unreadable_trade_bill"),
        ],
    )
    async def test_mapping_stop_writes_nothing(
        self, monkeypatch: pytest.MonkeyPatch, stop_class: str, edit: dict[str, str]
    ) -> None:
        """Why this matters: each mapping stop is a bill the mapper refuses to turn into a fill
        (an unproven venue product, an unknown contract size, a repeated tradeId, a trade subtype
        it has not proven, a trade bill without its id). One offending bill must keep EVERY other
        fill of the read out of ``trades``."""
        target_bill = "910000010" if stop_class == "duplicate_trade_id" else "910000009"
        world = _q3_world(
            monkeypatch, _csv_edit(fx.FILLS_Q3_PATH.read_bytes(), target_bill, **edit)
        )

        outcome = await dispatch(fk.job({"mode": "fills_apply"}))

        assert outcome.outcome == DispatchOutcome.FAILED
        result = world.result()
        assert result["stop_class"] == stop_class
        assert result["census"] is not None
        assert _upserts(world) == []

    @pytest.mark.asyncio
    async def test_reconcile_miss_on_one_target_writes_nothing_for_any(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Why this matters: S2's stored fills disagree with the archive over the overlap, so the
        archive cannot be trusted for the account; S1's perfectly good fills must not be written
        either, because the file is one account's single source for both."""
        bad = fx.stored_row("880000007", strategy_id=STRATEGY_2_ID)
        bad["quantity"] = "0.70000000"
        world = _install(
            monkeypatch,
            s2_trades=[bad, fx.stored_row("880000008", strategy_id=STRATEGY_2_ID)],
        )

        outcome = await dispatch(fk.job({"mode": "fills_apply"}))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message is not None
        assert "fills_reconcile_miss" in outcome.error_message
        assert "position=1" in outcome.error_message
        assert "field=quantity" in outcome.error_message
        assert _upserts(world) == []
        assert world.result()["stop_class"] == "fills_reconcile_miss"

    @pytest.mark.asyncio
    async def test_unperformed_reconcile_still_writes_proven_swap(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Why this matters: when the write bound sits inside the current, unfinished quarter there
        is no reconcile quarter, and a proven product (SWAP, USDT) with a passing bal chain must
        still be written, with the overlap recorded as ``not_performed`` (the quarter was not read), not as
        an empty window that was compared and found equal."""
        world = _install(monkeypatch, two_targets=False, now_ms=LATE_NOW_MS, today=LATE_TODAY)

        outcome = await dispatch(fk.job({"mode": "fills_apply"}, created_at_ms=LATE_NOW_MS))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        result = world.result()
        assert [r["state"] for r in result["reconcile"]["strategies"]] == ["not_performed"]
        assert result["info"]["bal_chain"]["total_pairs"] >= 4
        assert _upserts(world), "an empty overlap must still write"
        # The reconcile-window ids are inside the write window on this clock.
        assert sorted(_fill_ids(_sent(world)[STRATEGY_ID])) == sorted(
            (*fx.TRADE_IDS_WRITE_WINDOW, *fx.TRADE_IDS_RECONCILE_WINDOW)
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", ["unequal", "absent_in_archive", "unreadable"])
    async def test_apply_stops_on_legacy_mismatch(self, monkeypatch: pytest.MonkeyPatch, kind: str) -> None:
        """Why this matters: a stored row the archive contradicts (``unequal``), lacks
        (``absent_in_archive``) or that cannot be read is a sign the archive and fills-history
        disagree about this account. The runbook refuses to apply after such a calibrate, so the
        automatic chain must too: permanent stop, nothing written for ANY target."""
        write_id = fx.TRADE_IDS_WRITE_WINDOW[1]
        stored = fx.stored_row(write_id, strategy_id=STRATEGY_2_ID)
        if kind == "unequal":
            stored["fee"] = -0.99
        elif kind == "absent_in_archive":
            stored["exchange_fill_id"] = "990000001"
            stored["timestamp"] = "2026-05-25T08:00:00.123+00:00"
        else:
            stored["price"] = None
        world = _install(monkeypatch, s2_trades=[*_s2_trades(), stored])

        outcome = await dispatch(fk.job({"mode": "fills_apply"}))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_kind == "permanent"
        assert outcome.error_message is not None
        assert "fills_legacy_mismatch" in outcome.error_message
        assert "position=1" in outcome.error_message
        assert "targets=1" in outcome.error_message
        counts = {"unequal": 0, "absent_in_archive": 0, "unreadable": 0, kind: 1}
        for name, value in counts.items():
            assert f"{name}={value}" in outcome.error_message
        result = world.result()
        assert result["stop_class"] == "fills_legacy_mismatch"
        legacy = result["strategies"][1]["legacy"]
        assert {name: legacy[name] for name in counts} == counts
        assert result["strategies"][0]["legacy"]["unequal"] == 0
        assert _upserts(world) == [], "a legacy mismatch on S2 must keep S1's rows out too"

    @pytest.mark.asyncio
    async def test_apply_ignores_stored_rows_in_unread_spans(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Why this matters: a stored fill inside [anchor, write bound) but in the current, unread
        quarter cannot be compared with any archive bill. Counting it as ``absent_in_archive`` would
        be a false permanent stop (and a 14-day chain cooldown) on a perfectly healthy account."""
        unread = fx.stored_row(fx.TRADE_IDS_WRITE_WINDOW[0], strategy_id=STRATEGY_ID)
        unread["exchange_fill_id"] = "990000009"
        unread["timestamp"] = "2026-10-01T08:00:00.123+00:00"
        world = _install(
            monkeypatch,
            two_targets=False,
            s1_trades=[*_s1_trades(), unread],
            now_ms=LATE_NOW_MS,
            today=LATE_TODAY,
        )

        outcome = await dispatch(fk.job({"mode": "fills_apply"}, created_at_ms=LATE_NOW_MS))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        result = world.result()
        assert result["strategies"][0]["legacy"]["absent_in_archive"] == 0
        assert _upserts(world)

    @pytest.mark.asyncio
    async def test_apply_with_quarters_override_writes_without_reconcile(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Why this matters: the manual remedy for ``259-ARCHIVE-QUARTER-CAP`` reads chosen quarters
        only. With the reconcile quarter not requested the overlap is ``not_performed`` (recorded as such), the
        fills of the requested quarter are written, nothing of the unread quarter is, and the
        unread part of the window is named."""
        world = _install(monkeypatch, two_targets=False)

        outcome = await dispatch(
            fk.job({"mode": "fills_apply", "quarters": [{"year": 2026, "quarter": "Q2"}]})
        )

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        result = world.result()
        assert [r["state"] for r in result["reconcile"]["strategies"]] == ["not_performed"]
        q2_ids = [t for t in fx.TRADE_IDS_WRITE_WINDOW if t in ("880000002", "880000003", "880000004")]
        assert sorted(_fill_ids(_sent(world)[STRATEGY_ID])) == q2_ids
        spans = result["info"]["unread_spans"]
        assert any(s["reason"] == "not_requested" for s in spans)

    @pytest.mark.asyncio
    async def test_unread_spans_are_named_in_apply(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Why this matters: an anchor older than the four quarters one job reads leaves history
        unwritten; a DONE apply must name that (over-cap quarters an operator can copy into a manual
        job) instead of looking complete, and a later-anchored sibling names its before-anchor span."""
        world = _install(monkeypatch, anchors=("2025-01-15", fx.ANCHOR_DAY))
        header = (
            "instType,billId,subType,ts,balChg,posBalChg,bal,posBal,sz,px,ccy,pnl,fee,mgnMode,"
            "instId,ordId,execType,interest,tag,fillTime,tradeId,clOrdId,fillIdxPx,fillMarkPx,"
            "fillPxVol,fillPxUsd,fillMarkVol,fillFwdPx\n"
        )
        assert header.rstrip("\n") == fx.FILLS_Q3_PATH.read_text().splitlines()[0]

        def funding(bill: str, ts: int, chg: str, bal: str) -> str:
            return f"SWAP,{bill},173,{ts},{chg},0,{bal},0,,,USDT,{chg},0,cross,ETH-USDT-SWAP,,,,,,,,,,,,,\n"

        files = {
            "2025Q4": header + funding("900000001", 1759622400000, "-1.00", "4000.00")
            + funding("900000002", 1762300800000, "2.00", "4002.00"),
            "2026Q1": header + funding("900000011", 1767571200000, "-2.00", "4000.00")
            + funding("900000012", 1770249600000, "1000.00", "5000.00"),
        }
        for tag, text in files.items():
            world.csv_by_quarter[tag] = text.encode()

        outcome = await dispatch(fk.job({"mode": "fills_apply"}))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        info = world.result()["info"]
        assert info["over_cap_quarters"] == ["2025-Q1", "2025-Q2", "2025-Q3"]
        assert any(s["reason"] == "over_cap" for s in info["unread_spans"])
        assert any(
            s["reason"] == "before_anchor" and s.get("position") == 1 for s in info["unread_spans"]
        )


# ---------------------------------------------------------------------------
# Task 3: named, resumable write failures and the cross-module bindings
# ---------------------------------------------------------------------------

#: 3 Q2 fills + 2 Q3 fills + 145 generated = 150 write-window fills: two batches of 100 and 50.
EXTRA_BILLS = 145
WRITE_ROWS = 150


def _batch_world(monkeypatch: pytest.MonkeyPatch) -> World:
    world = _install(
        monkeypatch, two_targets=False, s1_trades=_s1_trades(fx.TRADE_IDS_RECONCILE_WINDOW)
    )
    world.csv_by_quarter["2026Q3"] = _q3_with_extra_trade_bills(EXTRA_BILLS)
    return world


class TestWriteFailures:
    @pytest.mark.asyncio
    async def test_batch_failure_is_named_and_counted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Why this matters: a failure after the first batch landed must not look like success or like
        nothing happened. It is the named transient stop, it counts what is already stored, and the
        exception text (which can carry row values) never reaches the error."""
        world = _batch_world(monkeypatch)
        assert world.supabase is not None
        world.supabase.upsert_errors[2] = RuntimeError("secret-row-value-3000.5")

        outcome = await dispatch(fk.job({"mode": "fills_apply"}))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_kind == "transient"
        assert outcome.error_message is not None
        assert "fills_write_failed" in outcome.error_message
        assert "inserted_before_failure=100" in outcome.error_message
        assert "secret-row-value" not in outcome.error_message
        result = world.result()
        assert result["stop_class"] == "fills_write_failed"
        assert result["strategies"][0]["inserted"] == 100
        assert len(_upserts(world)) == 1

    @pytest.mark.asyncio
    async def test_write_past_claim_budget_is_transient(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Why this matters: a write that outlives the claim budget must end as the named transient
        ``claim_budget_exceeded`` (the retry resumes idempotently), not as a generic cancellation
        that may have left a half-written batch unexplained."""
        world = _install(monkeypatch, two_targets=False)
        clock = {"now": 1000.0}
        monkeypatch.setattr(okx_archive_job, "_monotonic", lambda: clock["now"])
        real_reconcile = okx_archive_fills.reconcile_window

        def _then_the_budget_runs_out(*args: Any, **kwargs: Any) -> Any:
            out = real_reconcile(*args, **kwargs)
            clock["now"] += okx_archive_job.CLAIM_BUDGET_S + 1
            return out

        monkeypatch.setattr(okx_archive_fills, "reconcile_window", _then_the_budget_runs_out)

        outcome = await dispatch(fk.job({"mode": "fills_apply"}))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_kind == "transient"
        assert outcome.error_message is not None
        assert "claim_budget_exceeded" in outcome.error_message
        assert "step=write" in outcome.error_message
        assert _upserts(world) == []

    @pytest.mark.asyncio
    async def test_batches_are_written_newest_first(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Why this matters: a write that stops part way must leave the OLDEST fills unwritten. The
        chain's reach test reads the earliest stored fill, so an oldest-first partial write would put
        a fill next to the anchor, end the chain early and never complete the rest; newest first
        keeps the earliest stored fill far from the anchor until the last batch lands."""
        world = _batch_world(monkeypatch)

        outcome = await dispatch(fk.job({"mode": "fills_apply"}))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        first, second = (call["rows"] for call in _upserts(world))
        assert (len(first), len(second)) == (100, WRITE_ROWS - 100)
        assert min(r["timestamp"] for r in first) >= max(r["timestamp"] for r in second)
        assert min(r["timestamp"] for r in second) == min(
            r["timestamp"] for call in _upserts(world) for r in call["rows"]
        )
        assert min(r["timestamp"] for r in second) < min(r["timestamp"] for r in first)

    @pytest.mark.asyncio
    async def test_failure_with_an_unreadable_count_says_unknown(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Why this matters: ``inserted_before_failure=0`` after a batch whose answer could not be
        counted would tell the operator nothing landed when rows may have. A None count anywhere in
        the written targets must read ``unknown``, never a sum that quietly skips it."""
        world = _batch_world(monkeypatch)
        assert world.supabase is not None
        world.supabase.upsert_errors[2] = RuntimeError("boom")
        real_apply = world.supabase.apply_upsert
        answered: list[int] = []

        def _first_answer_is_not_a_list(*args: Any, **kwargs: Any) -> Any:
            resp = real_apply(*args, **kwargs)
            answered.append(1)
            if len(answered) == 1:
                resp.data = None  # the rows landed, but the answer cannot be counted
            return resp

        monkeypatch.setattr(world.supabase, "apply_upsert", _first_answer_is_not_a_list)

        outcome = await dispatch(fk.job({"mode": "fills_apply"}))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message is not None
        assert "fills_write_failed" in outcome.error_message
        assert "inserted_before_failure=unknown" in outcome.error_message
        assert world.result()["strategies"][0]["inserted"] is None

    @pytest.mark.asyncio
    async def test_write_failure_logs_only_a_sqlstate_code(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Why this matters: the class alone cannot tell a unique violation from a missing grant, but
        a PostgREST error's message, details and hint carry row values. Only a 5-character SQLSTATE
        may be logged; anything else in ``code`` (a free-text value) must stay out of the log."""
        for code, logged in (("23505", True), ("secret-row-value-3000.5", False)):
            caplog.clear()
            world = _batch_world(monkeypatch)
            assert world.supabase is not None
            err = RuntimeError("secret-row-message-3000.5")
            err.code = code  # type: ignore[attr-defined]
            err.details = "secret-row-details-3000.5"  # type: ignore[attr-defined]
            world.supabase.upsert_errors[1] = err

            with caplog.at_level("ERROR"):
                outcome = await dispatch(fk.job({"mode": "fills_apply"}))

            assert outcome.outcome == DispatchOutcome.FAILED
            assert ("code=23505" in caplog.text) is logged
            assert "secret-row" not in caplog.text
            assert "secret-row" not in (outcome.error_message or "")

    @pytest.mark.asyncio
    async def test_budget_running_out_mid_write_sets_the_count_unknown(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Why this matters: when the claim budget expires around a batch, that batch may have
        landed. The recorded ``inserted`` must be null (unknown), not the last count that was
        certain, so the result block never claims fewer rows than may be stored."""
        world = _batch_world(monkeypatch)
        assert world.supabase is not None
        clock = {"now": 1000.0}
        supabase = world.supabase
        monkeypatch.setattr(
            okx_archive_job,
            "_monotonic",
            lambda: clock["now"] + (okx_archive_job.CLAIM_BUDGET_S + 1 if supabase.upserts else 0),
        )

        outcome = await dispatch(fk.job({"mode": "fills_apply"}))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_kind == "transient"
        assert outcome.error_message is not None
        assert "claim_budget_exceeded" in outcome.error_message
        assert len(_upserts(world)) == 1
        assert world.result()["stop_class"] == "claim_budget_exceeded"
        assert world.result()["strategies"][0]["inserted"] is None

    @pytest.mark.asyncio
    async def test_retry_after_batch_failure_completes_idempotently(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Why this matters: the failed job is retried. The retry must store exactly the rows the
        failure left out, and each of the 150 fills exactly once, without any resume state."""
        world = _batch_world(monkeypatch)
        assert world.supabase is not None
        world.supabase.upsert_errors[2] = RuntimeError("boom")
        job = fk.job({"mode": "fills_apply"})

        failed = await dispatch(job)
        assert failed.outcome == DispatchOutcome.FAILED
        retried = await dispatch(job)

        assert retried.outcome == DispatchOutcome.DONE, retried.error_message
        assert world.last_result()["strategies"][0]["inserted"] == WRITE_ROWS - 100
        stored = [
            r["exchange_fill_id"]
            for r in world.supabase.tables["trades"]
            if r.get("strategy_id") == STRATEGY_ID
            and r["exchange_fill_id"] not in fx.TRADE_IDS_RECONCILE_WINDOW
        ]
        assert len(stored) == WRITE_ROWS
        assert len(set(stored)) == WRITE_ROWS


class TestBindings:
    def test_write_literals_bind_the_live_upsert(self) -> None:
        """Why this matters: the archive write must stay byte-for-byte the live fills write (same
        conflict key, same ignore flag, same batch size). A drift in either copy would make the
        archive rows conflict differently from fills-history's."""
        # The docstrings are cut first: ``_write_fills``'s own docstring names these literals, and a
        # test that read them there would stay green with the code changed.
        mine = _without_docstring(inspect.getsource(okx_archive_fills._write_fills))
        live = _without_docstring(inspect.getsource(job_worker.run_sync_trades_job))
        for literal in (
            'on_conflict="strategy_id,exchange,exchange_fill_id"',
            "ignore_duplicates=True",
            ", 100)",
        ):
            assert literal in live, f"the live write no longer has {literal}"
            assert literal in mine, f"_write_fills drifted from the live write: {literal}"

    def test_mode_and_kind_bindings(self) -> None:
        """Why this matters: the chain enqueues by literal and the handler dispatches by closed set;
        these identities are what keep the two modules talking about the same job."""
        assert okx_archive_fills_chain.FILLS_APPLY_MODE in okx_archive_fills.FILLS_MODES
        assert okx_archive_fills_chain.CHAIN_KIND == okx_archive_job.KIND
        assert okx_archive_fills.FILLS_STOP_CLASSES.isdisjoint(okx_archive_job.STOP_CLASSES)
        assert okx_archive_fills_map.ARCHIVE_SOURCE == okx_archive_job._ARCHIVE_SOURCE
        assert (
            okx_archive_fills.WRITE_BOUND_MARGIN_MS is okx_archive_fills_chain.WRITE_BOUND_MARGIN_MS
        )
        assert "WRITE_BOUND_MARGIN_MS =" not in inspect.getsource(okx_archive_fills)
