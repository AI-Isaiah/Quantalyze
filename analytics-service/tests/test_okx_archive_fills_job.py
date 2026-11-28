"""Phase 259 plan 05: the archive-fills job's read path (modes ``fills_calibrate`` and, up to its
write, ``fills_apply``).

What these tests protect, in one paragraph (Rule 9): the job reads one OKX account's quarterly
bills archive and, in a later plan, writes the trade bills of it into ``public.trades`` as fills.
Rows written with a wrong mapping, or from a truncated file, or against the wrong account, are
costly to repair, so every gate lives on the READ path and fires before anything is written:
the OKXHISTORY D-02 key and account checks, the bal chain over the files, the mapping and the
reconcile of the archive against the stored ``fills-history`` fills. ``fills_calibrate`` is the dry
run (the apply POST is budgeted at a dozen a day, so the first look at the real trade cells must
cost no write and no apply): it runs every gate and must leave ``trades`` untouched, because a
dry run that writes is not a dry run and a first PROD look at an unproven mapping is exactly where
a wrong row would land. The status reader here is GET only; a quarter OKX has not finished is a
named stop and never an apply, and the rebuild modes' own contract (stop classes, input rules,
Result shape v1) must come through the fork unchanged.

The fakes record every venue call by endpoint, and the fake ``trades`` table records every upsert,
so "zero APPLY calls" and "zero writes" are assertions about what was called.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import logging
from collections.abc import Callable
from datetime import date
from typing import Any

import ccxt.async_support as ccxt
import httpx
import pytest

from services import exchange as exchange_module
from services import okx_archive_job
from services.job_worker import DispatchOutcome, dispatch
from services.okx_archive_download import LinkExpired
from services.okx_archive_fills import (
    _cut_range,
    FILLS_MAX_APPLIES_PER_QUARTER,
    FILLS_MODES,
    FILLS_STOP_CLASSES,
    FILLS_TRANSIENT_STOP_CLASSES,
    plan_fill_quarters,
)
from services.okx_archive_fills_map import MAP_STOP_CLASSES
from services.okx_archive_job import (
    BACKSTOP_AFTER_S,
    FIRST_STATUS_READ_AFTER_S,
    GIVE_UP_AFTER_S,
    MAX_DEFER_S,
    MIN_APPLY_GAP_S,
    RATE_LIMIT_DEFER_S,
    STATUS_POLL_INTERVAL_S,
)
from tests import _okx_archive_fills_fakes as fk
from tests import _okx_archive_fills_fixtures as fx
from tests._okx_archive_fills_fakes import (
    APPLY,
    CONFIG,
    STATUS,
    STRATEGY_2_ID,
    STRATEGY_ID,
    World,
)

TODAY_DATE = date(2026, 11, 27)
HOUR_MS = 3_600_000
TRADE_BILLS = (
    len(fx.TRADE_IDS_BEFORE_ANCHOR)
    + len(fx.TRADE_IDS_WRITE_WINDOW)
    + len(fx.TRADE_IDS_RECONCILE_WINDOW)
)


@pytest.fixture(autouse=True)
def _no_raw_data(monkeypatch: pytest.MonkeyPatch) -> None:
    """The stored rows carry the trimmed ``raw_data`` the fixtures' oracle spells out."""
    monkeypatch.setattr(exchange_module, "_STORE_FULL_RAW_DATA", False)


def _setup(
    monkeypatch: pytest.MonkeyPatch,
    *,
    anchor_day: str | None = fx.ANCHOR_DAY,
    trade_ids: tuple[str, ...] = (*fx.TRADE_IDS_RECONCILE_WINDOW, fx.TRADE_IDS_WRITE_WINDOW[0]),
    now_ms: int = fx.NOW_MS,
    today: date = TODAY_DATE,
) -> World:
    """One connected OKX key (account U1), one strategy on it, its earliest daily return on
    ``anchor_day`` and the stored fills of ``trade_ids``."""
    daily = (
        [{"strategy_id": STRATEGY_ID, "date": anchor_day}] if anchor_day is not None else []
    )
    return fk.install(
        monkeypatch,
        keys=[fk.key()],
        strategies=[fk.strategy()],
        daily_returns=daily,
        trades=[fx.stored_row(t, strategy_id=STRATEGY_ID) for t in trade_ids],
        now_ms=now_ms,
        today=today,
    )


def _defers(world: World) -> list[dict[str, Any]]:
    """The ``defer_compute_job`` calls of the run, in order."""
    assert world.supabase is not None
    return [p for name, p in world.supabase.rpcs if name == "defer_compute_job"]


def _set_clock(monkeypatch: pytest.MonkeyPatch, now_ms: int) -> None:
    """Move the claim clock (the fills module reads ``_wall_ms`` off ``okx_archive_job`` at call
    time, so one patch reaches the age checks of both modules)."""
    monkeypatch.setattr(okx_archive_job, "_wall_ms", lambda: now_ms)


# ---------------------------------------------------------------------------
# Task 1: the tracer
# ---------------------------------------------------------------------------

class TestTracer:
    @pytest.mark.asyncio
    async def test_tracer_calibrate_end_to_end(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """A calibrate flows dispatch, fork, D-02, status read, download, parse, bal chain, map,
        reconcile and ends DONE with ONE result write, ZERO writes to trades and ZERO apply calls:
        the dry run exercises every gate and costs nothing."""
        caplog.set_level(logging.DEBUG)
        world = _setup(monkeypatch)

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}))

        assert outcome.outcome == DispatchOutcome.DONE
        assert outcome.error_message is None
        result = world.result()
        assert result["mode"] == "fills_calibrate"
        assert result["stop_class"] is None
        q2, q3 = result["quarters"]
        assert (q2["year"], q2["quarter"], q2["role"], q2["applies"]) == (2026, "Q2", "write", 0)
        assert (q3["year"], q3["quarter"], q3["role"], q3["applies"]) == (
            2026, "Q3", "write_reconcile", 0,
        )
        assert q2["state"] == q3["state"] == "finished"
        assert result["census"]["trade_bills"] == TRADE_BILLS
        assert result["info"]["bal_chain"]["total_pairs"] >= 4
        assert result["info"]["outcome"] == "read_complete"
        (reading,) = result["reconcile"]["strategies"]
        assert reading["state"] == "equal"
        (target,) = result["strategies"]
        assert target["position"] == 0
        assert target["state"] == "read"
        assert target["would_insert"] == len(fx.TRADE_IDS_WRITE_WINDOW) - 1
        assert target["before_anchor"] == len(fx.TRADE_IDS_BEFORE_ANCHOR)
        assert target["legacy"]["matched"] == 1
        assert target["inserted"] is None

        assert world.calls_of(APPLY) == 0, "a calibrate never applies"
        assert world.supabase is not None
        assert world.supabase.upserts == [], "a calibrate never writes trades"
        # The reads came before the (one) result write, on the one preflight instance.
        assert len(world.instances) == 1

        everything = json.dumps(world.progress_writes()) + caplog.text + repr(outcome)
        for secret in fk.LINK_SECRETS:
            assert secret not in everything, f"the link leaked: {secret!r}"
        for trade_id in fx.EXPECTED_ROWS:
            assert trade_id not in everything, "a tradeId reached the result or a log"
        assert "U1" not in json.dumps(result), "the account uid must not be stored"
        assert STRATEGY_ID not in json.dumps(result), "the result names no strategy id"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("raw_mode", ["nonsense", None])
    async def test_fork_leaves_rebuild_modes_untouched(
        self, monkeypatch: pytest.MonkeyPatch, raw_mode: Any
    ) -> None:
        """The fork reads two literals. An unknown or missing mode is still the rebuild's
        ``invalid_input`` with the rebuild's own result block (a mode is echoed only when it is a
        member of its closed set), so the existing job contract passes through unchanged."""
        world = _setup(monkeypatch)

        outcome = await dispatch(fk.job({"mode": raw_mode}))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message == "okx_archive_rebuild: invalid_input"
        assert outcome.error_kind == "permanent"
        result = world.result()
        assert result["stop_class"] == "invalid_input"
        assert result["mode"] is None
        assert world.decrypts == 0

    def test_fills_modes_are_forked_by_literal(self) -> None:
        assert FILLS_MODES == ("fills_calibrate", "fills_apply")
        source = inspect.getsource(okx_archive_job.run_okx_archive_rebuild_job)
        for literal in FILLS_MODES:
            assert f'"{literal}"' in source
        # The rebuild's own mode tables did not learn the new names.
        assert not set(FILLS_MODES) & set(okx_archive_job.MODES)
        assert not set(FILLS_MODES) & set(okx_archive_job.ACCEPTED_MODES)

    @pytest.mark.asyncio
    async def test_tracer_wait_across_claims(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Why this matters: the apply POST is budgeted at a dozen a day per OKX user and OKX needs
        hours to generate a file, so a job must spend ONE apply per quarter, remember it across
        claims (a stateless GET cannot tell "never applied" from "applied, not shown yet"), park
        itself instead of sleeping, and finish only when OKX says finished.

        Claim 1: OKX has no entry for either quarter -> one apply each, alone on its own fresh
        client, deferred. Claim 2: OKX shows the request ongoing -> no apply, count carried.
        Claim 3: finished -> DONE, and the apply total over the three claims is two."""
        caplog.set_level(logging.DEBUG)
        world = _setup(monkeypatch)
        assert world.supabase is not None
        world.answers[STATUS] = fk.no_entry()
        world.answers[APPLY] = fk.apply_answer("false", ts=fx.NOW_MS)
        job = fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS)

        # --- claim 1: no entry -> one apply per quarter
        first = await dispatch(job)

        assert first.outcome == DispatchOutcome.DEFERRED
        assert world.calls_of(APPLY) == 2
        applying = [inst for inst in world.instances if APPLY in inst.calls]
        assert len(applying) == 2
        for inst in applying:
            assert inst.calls == [APPLY], "an apply is the only and the last call on its client"
            assert inst.closed
        assert applying[0] is not world.instances[0], "the preflight client never applies"
        assert [p["p_defer_seconds"] for p in _defers(world)] == [
            min(FIRST_STATUS_READ_AFTER_S, MAX_DEFER_S)
        ]
        written = world.last_result()
        assert [q["applies"] for q in written["quarters"]] == [1, 1]
        assert written["info"]["outcome"] == "waiting"
        assert world.supabase.upserts == []

        # --- claim 2: OKX shows the request, one hour old -> no apply, count carried
        job = world.reclaim(job)
        _set_clock(monkeypatch, fx.NOW_MS + HOUR_MS)
        world.answers[STATUS] = fk.status("ongoing", ts=fx.NOW_MS)
        second = await dispatch(job)

        assert second.outcome == DispatchOutcome.DEFERRED
        assert world.calls_of(APPLY) == 2, "an ongoing request is never applied for again"
        assert _defers(world)[-1]["p_defer_seconds"] == STATUS_POLL_INTERVAL_S
        assert [q["applies"] for q in world.last_result()["quarters"]] == [1, 1]

        # --- claim 3: finished -> DONE with the calibrate result, zero writes
        job = world.reclaim(job)
        _set_clock(monkeypatch, fx.NOW_MS + 3 * HOUR_MS)
        world.answers[STATUS] = lambda _inst, params: fk.finished(params["year"], params["quarter"])
        third = await dispatch(job)

        assert third.outcome == DispatchOutcome.DONE
        assert world.calls_of(APPLY) == 2, "the apply total over three claims is two"
        result = world.last_result()
        assert result["stop_class"] is None
        assert result["info"]["outcome"] == "read_complete"
        assert [q["state"] for q in result["quarters"]] == ["finished", "finished"]
        assert [q["applies"] for q in result["quarters"]] == [1, 1]
        assert result["census"]["trade_bills"] == TRADE_BILLS
        (reading,) = result["reconcile"]["strategies"]
        assert reading["state"] == "equal"
        assert world.supabase.upserts == [], "a calibrate never writes trades"
        assert len(_defers(world)) == 2, "the finishing claim does not defer"

        everything = json.dumps(world.progress_writes()) + caplog.text
        for secret in fk.LINK_SECRETS:
            assert secret not in everything, f"the link leaked: {secret!r}"


# ---------------------------------------------------------------------------
# The quarter plan (a pure function of data)
# ---------------------------------------------------------------------------

def _plan(
    anchor_ms: list[int],
    *,
    now_ms: int = fx.NOW_MS,
    today: date = TODAY_DATE,
    override: tuple[tuple[int, str], ...] | None = None,
) -> Any:
    floor_ms = exchange_module._okx_fills_begin_floor_ms(now_ms)
    return plan_fill_quarters(
        anchor_ms,
        write_bound_ms=floor_ms + 86_400_000,
        floor_ms=floor_ms,
        today=today,
        override=override,
    )


class TestOkxNoRequestAnswer:
    @pytest.mark.asyncio
    async def test_okx_51604_on_the_status_get_is_no_entry_and_applies(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Why this matters: measured on PROD 2026-11-28, OKX answers the status GET for a quarter
        it holds no request for with error 51604, never with an empty ``data`` list. Read as a
        venue failure, the first calibrate died after three attempts without ever applying, so
        no archive file could ever be requested. 51604 is "no entry": the job applies once per
        quarter and defers. Any other venue error still propagates."""
        world = _setup(monkeypatch)

        def _no_request(_inst: Any, _params: dict[str, str]) -> Any:
            raise ccxt.BadRequest(
                'okx {"code":"51604","data":[],"msg":"Initiate a download request before '
                'obtaining the hyperlink"}'
            )

        world.answers[STATUS] = _no_request
        world.answers[APPLY] = fk.apply_answer("false", ts=fx.NOW_MS)
        job = fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS)

        first = await dispatch(job)

        assert first.outcome == DispatchOutcome.DEFERRED
        assert world.calls_of(APPLY) == 2
        assert [q["applies"] for q in world.last_result()["quarters"]] == [1, 1]

    @pytest.mark.asyncio
    async def test_other_venue_error_on_the_status_get_still_propagates(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _setup(monkeypatch)

        def _other(_inst: Any, _params: dict[str, str]) -> Any:
            raise ccxt.BadRequest('okx {"code":"50014","data":[],"msg":"Parameter year error"}')

        world.answers[STATUS] = _other
        job = fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS)

        await dispatch(job)

        assert world.calls_of(APPLY) == 0


class TestQuarterPlan:
    """Why these matter: the quarter plan decides which span of an account's history is read, and a
    span it silently drops is a hole in a track record nobody is told about. Every choice is derived
    from data, and every span it does not read is named with a reason."""

    def test_plan_quarters_anchor_in_q2(self) -> None:
        plan = _plan([fx.ANCHOR_MS])  # 2026-05-01
        assert plan.read == ((2026, "Q2"), (2026, "Q3"))
        assert plan.reconcile == (2026, "Q3")
        assert plan.over_cap == ()
        assert plan.unread_spans == ()

    def test_plan_quarters_anchor_in_q1(self) -> None:
        plan = _plan([1771804800000])  # 2026-02-23
        assert plan.read == ((2026, "Q1"), (2026, "Q2"), (2026, "Q3"))
        assert plan.reconcile == (2026, "Q3")
        assert plan.over_cap == ()

    def test_plan_quarters_anchor_inside_reach_reads_nothing(self) -> None:
        plan = _plan([1790812800000])  # 2026-10-01
        assert plan.read == () and plan.reconcile is None and plan.over_cap == ()

    def test_plan_quarters_no_anchor_reads_nothing(self) -> None:
        assert _plan([]).read == ()

    def test_plan_quarters_over_cap_keeps_newest_four(self) -> None:
        """Five or more ended quarters meet the window: the newest four are read and the older ones
        are named by tag (the known gap ``259-ARCHIVE-QUARTER-CAP``), so an operator can copy them
        into a manual job instead of discovering a hole."""
        plan = _plan([1736899200000])  # 2025-01-15
        assert plan.read == ((2025, "Q4"), (2026, "Q1"), (2026, "Q2"), (2026, "Q3"))
        assert plan.over_cap == ((2025, "Q1"), (2025, "Q2"), (2025, "Q3"))
        assert plan.reconcile == (2026, "Q3")
        assert plan.unread_spans == (
            {"from_day": "2025-01-15", "until_day": "2025-09-30", "reason": "over_cap"},
        )
        # 2025 Q4's file starts at 2025-09-30T16:00Z: the span ends on that day.
        assert _cut_range(2025, "Q4")[0] == 1759248000000

    @pytest.mark.asyncio
    async def test_plan_quarters_over_cap_tags_reach_the_result(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The same tags, through the handler: ``info.over_cap_quarters`` is what the operator reads.
        A first status read that answers drift ends the run, and the block (with the plan's quarters
        and tags) is written before the stop."""
        world = _setup(monkeypatch, anchor_day="2025-01-15")
        world.answers[STATUS] = ["drift"]

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS))

        assert outcome.outcome == DispatchOutcome.FAILED
        info = world.last_result()["info"]
        assert info["over_cap_quarters"] == ["2025-Q1", "2025-Q2", "2025-Q3"]
        assert {"from_day": "2025-01-15", "until_day": "2025-09-30", "reason": "over_cap"} in (
            info["unread_spans"]
        )
        assert [(q["year"], q["quarter"]) for q in world.last_result()["quarters"]] == [
            (2025, "Q4"), (2026, "Q1"), (2026, "Q2"), (2026, "Q3"),
        ]

    def test_plan_quarters_pre_archive(self) -> None:
        """OKX's archive starts with 2021 Q1: an anchor before it leaves a span no source can
        supply, which is named rather than hidden."""
        plan = _plan([1590969600000], override=((2021, "Q1"),))  # anchor 2020-06-01
        assert plan.read == ((2021, "Q1"),)
        # 2021 Q1's file starts at 2020-12-31T16:00Z.
        assert {"from_day": "2020-06-01", "until_day": "2020-12-31", "reason": "pre_archive"} in (
            plan.unread_spans
        )

    def test_plan_quarters_window_empty(self) -> None:
        """With the clock at the end of December the write bound lies inside the not-yet-ended Q4:
        no read quarter contains it, so there is no reconcile quarter."""
        plan = _plan([fx.ANCHOR_MS], now_ms=1798718400000, today=date(2026, 12, 31))
        assert plan.reconcile is None
        assert plan.read == ((2026, "Q2"), (2026, "Q3"))

    def test_plan_quarters_unreachable_span(self) -> None:
        """Between the current quarter's file cut (2026-09-30T16:00Z) and fills-history's floor
        neither source reaches: the span is named, never hidden."""
        plan = _plan([fx.ANCHOR_MS], now_ms=1798747200000, today=date(2026, 12, 31))
        assert plan.read == ((2026, "Q2"), (2026, "Q3"))
        assert plan.unread_spans == (
            {"from_day": "2026-09-30", "until_day": "2026-10-01", "reason": "unreachable"},
        )

    def test_plan_quarters_override_names_not_requested(self) -> None:
        """An operator override reads exactly what was asked, and the derived quarter it was not
        asked for is named, with the part of the window it covers."""
        plan = _plan([fx.ANCHOR_MS], override=((2026, "Q2"),))
        assert plan.read == ((2026, "Q2"),)
        assert plan.reconcile is None
        assert plan.over_cap == ()
        # Q3's file starts 2026-06-30T16:00Z; the window ends at the write bound, 2026-08-29.
        assert plan.unread_spans == (
            {"from_day": "2026-06-30", "until_day": "2026-08-29", "reason": "not_requested"},
        )


# ---------------------------------------------------------------------------
# Task 2: the per-target readings and the named spans
# ---------------------------------------------------------------------------

def _stored(trade_id: str, **changes: Any) -> dict[str, Any]:
    row = fx.stored_row(trade_id, strategy_id=STRATEGY_ID)
    row.update(changes)
    return row


class TestTargetReadings:
    @pytest.mark.asyncio
    async def test_nothing_to_read_never_decrypts(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """An anchor inside fills-history's reach has nothing the archive could add. The job ends
        DONE and names it, and never decrypts a key, builds a client or calls OKX: reading a user's
        exchange account for nothing is exactly what the order of the gates exists to avoid."""
        world = _setup(monkeypatch, anchor_day="2026-10-01")

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}))

        assert outcome.outcome == DispatchOutcome.DONE
        result = world.result()
        assert result["info"]["outcome"] == "nothing_to_read"
        assert result["quarters"] == []
        assert result["strategies"][0]["state"] == "anchor_in_reach"
        assert world.decrypts == 0
        assert world.constructions == 0
        assert world.all_calls == []
        assert world.supabase is not None
        assert world.supabase.upserts == []

    @pytest.mark.asyncio
    async def test_strategy_without_anchor_is_named(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A sibling strategy with no daily return has no anchor: it is named ``no_anchor``, nothing
        is written for it and it does not widen the quarter plan (an unanchored strategy must not
        pull in quarters on a guess)."""
        world = fk.install(
            monkeypatch,
            keys=[fk.key()],
            strategies=[fk.strategy(), fk.strategy(STRATEGY_2_ID)],
            daily_returns=[{"strategy_id": STRATEGY_ID, "date": fx.ANCHOR_DAY}],
            trades=[fx.stored_row(t, strategy_id=STRATEGY_ID) for t in fx.TRADE_IDS_RECONCILE_WINDOW],
            now_ms=fx.NOW_MS,
            today=TODAY_DATE,
        )

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}))

        assert outcome.outcome == DispatchOutcome.DONE
        result = world.result()
        anchored, unanchored = result["strategies"]
        assert (anchored["position"], anchored["state"]) == (0, "read")
        assert (unanchored["position"], unanchored["state"]) == (1, "no_anchor")
        assert unanchored["would_insert"] == 0 and unanchored["archive_fills_in_window"] == 0
        assert result["reconcile"]["strategies"][1] == {"position": 1, "state": "not_read"}
        assert [(q["year"], q["quarter"]) for q in result["quarters"]] == [(2026, "Q2"), (2026, "Q3")]

    @pytest.mark.asyncio
    async def test_before_anchor_span_named(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Archive fills of a read quarter that lie before the target's anchor are counted and their
        span is named with the target's position, never written and never silently dropped."""
        world = _setup(monkeypatch, trade_ids=fx.TRADE_IDS_RECONCILE_WINDOW)

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}))

        assert outcome.outcome == DispatchOutcome.DONE
        result = world.result()
        (target,) = result["strategies"]
        assert target["before_anchor"] == len(fx.TRADE_IDS_BEFORE_ANCHOR)
        assert {
            "from_day": "2026-03-31",
            "until_day": "2026-05-01",
            "reason": "before_anchor",
            "position": 0,
        } in result["info"]["unread_spans"]
        # The before-anchor fill is not in the write set.
        assert target["archive_fills_in_window"] == len(fx.TRADE_IDS_WRITE_WINDOW)
        assert target["would_insert"] == len(fx.TRADE_IDS_WRITE_WINDOW)

    @pytest.mark.asyncio
    async def test_legacy_reading_counts_only_read_quarters(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """With the clock at the end of December the write bound lies inside the not-yet-ended Q4.
        A stored fill of early October is inside [anchor, write bound) but in a span this job did
        not read, so it cannot be compared with an archive bill: it must not be reported as absent
        from the archive, which would be a false alarm about a row nothing could have matched."""
        outside = _stored(
            fx.TRADE_IDS_WRITE_WINDOW[0],
            exchange_fill_id="990000001",
            timestamp="2026-10-01T08:00:00.123+00:00",
        )
        world = _setup(
            monkeypatch,
            trade_ids=(fx.TRADE_IDS_WRITE_WINDOW[0],),
            now_ms=1798718400000,
            today=date(2026, 12, 31),
        )
        assert world.supabase is not None
        world.supabase.tables["trades"].append(outside)

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}))

        assert outcome.outcome == DispatchOutcome.DONE
        result = world.result()
        (target,) = result["strategies"]
        assert target["legacy"]["absent_in_archive"] == 0
        assert target["legacy"]["stored"] == 1
        assert target["legacy"]["matched"] == 1
        assert target["already_stored"] == 1
        assert result["reconcile"]["strategies"][0]["state"] == "not_performed"
        assert {"from_day": "2026-09-30", "until_day": "2026-10-01", "reason": "unreachable"} in (
            result["info"]["unread_spans"]
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("changed", "expected"),
        [
            (
                lambda: _stored(fx.TRADE_IDS_WRITE_WINDOW[0], fee=-9.99),
                {"unequal": 1, "absent_in_archive": 0, "unreadable": 0},
            ),
            (
                lambda: _stored(
                    fx.TRADE_IDS_WRITE_WINDOW[0],
                    exchange_fill_id="990000001",
                    timestamp="2026-05-06T08:00:00.123+00:00",
                ),
                {"unequal": 0, "absent_in_archive": 1, "unreadable": 0},
            ),
            (
                lambda: _stored(fx.TRADE_IDS_WRITE_WINDOW[1], price=None),
                {"unequal": 0, "absent_in_archive": 0, "unreadable": 1},
            ),
        ],
        ids=["unequal", "absent_in_archive", "unreadable"],
    )
    async def test_calibrate_reports_legacy_mismatch_without_stopping(
        self, monkeypatch: pytest.MonkeyPatch, changed: Any, expected: dict[str, int]
    ) -> None:
        """The legacy reading (stored rows of the write window against their archive bills) is
        the evidence the runbook's go/no-go reads, so a calibrate REPORTS a mismatch and still ends
        DONE; only an apply stops on it (plan 07)."""
        world = _setup(monkeypatch, trade_ids=fx.TRADE_IDS_RECONCILE_WINDOW)
        assert world.supabase is not None
        world.supabase.tables["trades"].append(changed())

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}))

        assert outcome.outcome == DispatchOutcome.DONE
        result = world.result()
        assert result["stop_class"] is None
        legacy = result["strategies"][0]["legacy"]
        for name, count in expected.items():
            assert legacy[name] == count, name
        if expected["unequal"]:
            assert legacy["unequal_by_field"] == {"fee": 1}

    def test_fills_stop_classes_closed(self) -> None:
        """The fills job's classes are its own: the mapper's, plus the three the fills path owns. They
        must not collide with the rebuild's closed set (a new member there breaks its pinned set),
        and ``fills_legacy_mismatch`` is permanent: a retry would read the same rows. The two
        transient ones are retries that cannot repeat a refusal: a write that resumes idempotently
        and an apply count that could not be stored (no POST was made)."""
        assert FILLS_STOP_CLASSES == MAP_STOP_CLASSES | {
            "fills_write_failed",
            "fills_count_not_persisted",
            "fills_legacy_mismatch",
        }
        assert not FILLS_STOP_CLASSES & okx_archive_job.STOP_CLASSES
        assert FILLS_TRANSIENT_STOP_CLASSES == {"fills_write_failed", "fills_count_not_persisted"}


class TestGatesStopTheWholeRead:
    @pytest.mark.asyncio
    async def test_reconcile_miss_names_position_and_field_and_writes_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Where the archive and the stored ``fills-history`` fills overlap they must agree on
        every field. A stored fee that differs is a miss: the whole read stops by name (position
        and field, no value), the reading is in the result, and nothing is written."""
        world = _setup(monkeypatch, trade_ids=fx.TRADE_IDS_WRITE_WINDOW[:1])
        assert world.supabase is not None
        world.supabase.tables["trades"] += [
            _stored(fx.TRADE_IDS_RECONCILE_WINDOW[0], fee=-0.99),
            _stored(fx.TRADE_IDS_RECONCILE_WINDOW[1]),
        ]

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_kind == "permanent"
        assert outcome.error_message is not None
        assert outcome.error_message.startswith("okx_archive_rebuild: fills_reconcile_miss ")
        assert "position=0" in outcome.error_message and "field=fee" in outcome.error_message
        assert "0.99" not in outcome.error_message and "88000" not in outcome.error_message
        result = world.result()
        assert result["stop_class"] == "fills_reconcile_miss"
        reading = result["reconcile"]["strategies"][0]
        assert reading["state"] == "miss" and reading["field"] == "fee"
        assert world.supabase.upserts == []
        assert world.calls_of(APPLY) == 0

    @pytest.mark.asyncio
    async def test_broken_bal_chain_stops_before_any_mapping(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A file with a row missing or altered does not chain: ``archive_incomplete`` names the
        cause and nothing is mapped or written. This is what makes an un-checksummed file safe to
        publish as trade history."""
        world = _setup(monkeypatch)
        data = fx.FILLS_Q2_PATH.read_bytes()
        assert b",5010.15," in data
        world.csv_by_quarter["2026Q2"] = data.replace(b",5010.15,", b",5010.16,", 1)

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message is not None
        assert outcome.error_message.startswith("okx_archive_rebuild: archive_incomplete")
        assert "cause=bal_chain_break" in outcome.error_message
        result = world.result()
        assert result["stop_class"] == "archive_incomplete"
        assert result["info"]["bal_chain"]["reason"] == "bal_chain_break"
        assert result["info"]["outcome"] == "stopped"
        assert result["census"]["trade_bills"] == TRADE_BILLS
        assert world.supabase is not None
        assert world.supabase.upserts == []


# ---------------------------------------------------------------------------
# Task 2: the wait and the apply budget
# ---------------------------------------------------------------------------

#: One quarter only (Q3, which contains the write bound), so an arm counts one quarter's applies.
Q3_ONLY: dict[str, Any] = {
    "mode": "fills_calibrate",
    "quarters": [{"year": 2026, "quarter": "Q3"}],
}


def _fresh_applies(world: World) -> list[Any]:
    """The clients that made an apply POST. Each must be alone on its own client, as its last call,
    and closed (ccxt prices the POST so high that any later call on the same client blocks for
    about two hours)."""
    applying = [inst for inst in world.instances if APPLY in inst.calls]
    for inst in applying:
        assert inst.calls == [APPLY]
        assert inst.closed
    assert world.instances[0] not in applying, "the preflight client never applies"
    return applying


async def _run_claims(
    world: World,
    monkeypatch: pytest.MonkeyPatch,
    job: dict[str, Any],
    status_for: Callable[[int], Any],
    *,
    claims: int,
    step_ms: int = HOUR_MS,
) -> list[Any]:
    """Claim the same job ``claims`` times. Each claim sees the previous claim's stored result block
    (``world.reclaim``), the clock ``step_ms`` later and ``status_for(index)`` as OKX's answer. A
    claim that does not defer ends the run (a stop or DONE is final)."""
    outcomes: list[Any] = []
    for index in range(claims):
        _set_clock(monkeypatch, fx.NOW_MS + index * step_ms)
        world.answers[STATUS] = status_for(index)
        outcome = await dispatch(job)
        outcomes.append(outcome)
        if outcome.outcome != DispatchOutcome.DEFERRED:
            break
        job = world.reclaim(job)
    return outcomes


def _quarter_applies(world: World) -> list[int]:
    return [q["applies"] for q in world.last_result()["quarters"]]


def _progress_before_defer(world: World) -> None:
    """The result block is written BEFORE the defer: it carries the counts the next claim reads."""
    names = [name for kind, name in world.timeline if kind == "rpc"]
    assert "defer_compute_job" in names and "set_compute_job_progress" in names
    assert names.index("set_compute_job_progress") < names.index("defer_compute_job")


class TestApplyBudget:
    @pytest.mark.asyncio
    async def test_apply_budget_zero_applies_when_finished(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """OKX already has the files: nothing is requested, so the budget of a dozen a day per OKX
        user is not touched by a job that has nothing to ask for."""
        world = _setup(monkeypatch)

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}))

        assert outcome.outcome == DispatchOutcome.DONE
        assert world.calls_of(APPLY) == 0
        assert _quarter_applies(world) == [0, 0]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "answer",
        [
            fk.status("ongoing", ts=fx.NOW_MS - HOUR_MS),
            fk.status("finished", href="", ts=fx.NOW_MS - HOUR_MS),
        ],
        ids=["ongoing", "finished_without_link"],
    )
    async def test_apply_budget_zero_applies_when_ongoing(
        self, monkeypatch: pytest.MonkeyPatch, answer: dict[str, Any]
    ) -> None:
        """A request OKX is generating (or a finished one that shows no link yet) is waited for,
        never re-requested: a second apply would only spend budget."""
        world = _setup(monkeypatch)
        world.answers[STATUS] = answer
        job = fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS)

        outcome = await dispatch(job)

        assert outcome.outcome == DispatchOutcome.DEFERRED
        assert world.calls_of(APPLY) == 0
        assert [p["p_defer_seconds"] for p in _defers(world)] == [STATUS_POLL_INTERVAL_S]
        assert _quarter_applies(world) == [0, 0]
        _progress_before_defer(world)
        assert world.downloads == [], "nothing is downloaded while a quarter waits"

    @pytest.mark.asyncio
    async def test_apply_budget_no_entry_applies_once_on_fresh_instance(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _setup(monkeypatch)
        world.answers[STATUS] = fk.no_entry()
        world.answers[APPLY] = fk.apply_answer("false", ts=fx.NOW_MS)

        outcome = await dispatch(fk.job(Q3_ONLY, created_at_ms=fx.NOW_MS))

        assert outcome.outcome == DispatchOutcome.DEFERRED
        assert world.calls_of(APPLY) == 1
        assert len(_fresh_applies(world)) == 1
        assert _quarter_applies(world) == [1]
        _progress_before_defer(world)
        assert world.supabase is not None
        assert world.supabase.upserts == []

    @pytest.mark.asyncio
    async def test_apply_budget_no_entry_persists_never_reapplies(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """RESEARCH A6 is unmeasured: OKX may keep answering "no entry" for a while after an apply.
        A stateless step would apply again on every claim and burn the day's budget. The count is
        carried in the job's own result block, so over six claims the quarter is applied for ONCE;
        and a request OKX never shows ends the job by name once the job is old enough."""
        world = _setup(monkeypatch)
        world.answers[APPLY] = fk.apply_answer("false", ts=fx.NOW_MS)
        job = fk.job(Q3_ONLY, created_at_ms=fx.NOW_MS)

        outcomes = await _run_claims(
            world, monkeypatch, job, lambda _i: fk.no_entry(), claims=6, step_ms=2 * HOUR_MS
        )

        assert world.calls_of(APPLY) == 1, "applied once over every claim"
        assert [o.outcome for o in outcomes[:-1]] == [DispatchOutcome.DEFERRED] * (len(outcomes) - 1)
        # The clock reached the job age bound (4 x 2 h = 8 h) on the fifth claim.
        assert len(outcomes) == 5
        assert GIVE_UP_AFTER_S == 4 * 2 * 3600
        last = outcomes[-1]
        assert last.outcome == DispatchOutcome.FAILED
        assert last.error_message == (
            "okx_archive_rebuild: archive_request_failed quarter=2026-Q3 state=no_entry "
            "cause=no_entry_after_apply"
        )
        assert world.last_result()["stop_class"] == "archive_request_failed"
        assert _quarter_applies(world) == [1]

    @pytest.mark.asyncio
    async def test_apply_budget_failed_reapplies_up_to_max(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A request OKX reports ``failed`` may be retried, but only up to the cap, ever: the
        count survives the claims, then the job stops by name instead of looping."""
        world = _setup(monkeypatch)
        world.answers[APPLY] = fk.apply_answer("false", ts=fx.NOW_MS)
        job = fk.job(Q3_ONLY, created_at_ms=fx.NOW_MS)

        outcomes = await _run_claims(
            world,
            monkeypatch,
            job,
            lambda _i: fk.status("failed", ts=fx.NOW_MS),
            claims=6,
        )

        assert FILLS_MAX_APPLIES_PER_QUARTER == 2
        assert world.calls_of(APPLY) == FILLS_MAX_APPLIES_PER_QUARTER
        assert len(outcomes) == FILLS_MAX_APPLIES_PER_QUARTER + 1
        assert outcomes[-1].outcome == DispatchOutcome.FAILED
        assert outcomes[-1].error_message == (
            "okx_archive_rebuild: archive_request_failed quarter=2026-Q3 state=failed"
        )
        assert _quarter_applies(world) == [FILLS_MAX_APPLIES_PER_QUARTER]
        assert len(_fresh_applies(world)) == FILLS_MAX_APPLIES_PER_QUARTER

    @pytest.mark.asyncio
    async def test_apply_budget_three_quarters_six_claims(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Three quarters, six claims: one apply each on the first claim, and none afterwards while
        OKX generates. Three applies in total, each alone on its own client."""
        world = _setup(monkeypatch, anchor_day="2026-02-23")
        world.answers[APPLY] = fk.apply_answer("false", ts=fx.NOW_MS)
        job = fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS)

        outcomes = await _run_claims(
            world,
            monkeypatch,
            job,
            lambda i: fk.no_entry() if i == 0 else fk.status("ongoing", ts=fx.NOW_MS),
            claims=6,
        )

        assert [o.outcome for o in outcomes] == [DispatchOutcome.DEFERRED] * 6
        assert [(q["year"], q["quarter"]) for q in world.last_result()["quarters"]] == [
            (2026, "Q1"), (2026, "Q2"), (2026, "Q3"),
        ]
        assert world.calls_of(APPLY) == 3
        assert len(_fresh_applies(world)) == 3
        assert _quarter_applies(world) == [1, 1, 1]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "carried",
        [
            {"year": 2026, "quarter": "Q3", "applies": "x"},
            {"year": 2026, "quarter": "Q3", "applies": True},
            {"year": 2026, "quarter": "Q3", "applies": -1},
            {"year": 2026, "quarter": "Q3", "applies": None},
            {"year": 2026, "quarter": "Q3"},
        ],
        ids=["text", "bool", "negative", "null", "absent"],
    )
    async def test_apply_budget_malformed_prior_count_is_spent(
        self, monkeypatch: pytest.MonkeyPatch, carried: dict[str, Any]
    ) -> None:
        """A count that cannot be read must never read as "nothing spent": with the budget unknown
        the quarter is treated as spent, so a ``failed`` request stops by name, with no apply."""
        world = _setup(monkeypatch)
        world.answers[STATUS] = fk.status("failed", ts=fx.NOW_MS)
        job = fk.job(Q3_ONLY, created_at_ms=fx.NOW_MS)
        job["metadata"]["member_progress"] = {"quarters": [carried]}

        outcome = await dispatch(job)

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message == (
            "okx_archive_rebuild: archive_request_failed quarter=2026-Q3 state=failed"
        )
        assert world.calls_of(APPLY) == 0

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "progress",
        ["not a mapping", {"quarters": "not a list"}, {"quarters": ["not a mapping"]}],
        ids=["progress_text", "quarters_text", "entry_text"],
    )
    async def test_apply_budget_unreadable_block_marks_every_quarter_spent(
        self, monkeypatch: pytest.MonkeyPatch, progress: Any
    ) -> None:
        world = _setup(monkeypatch)
        world.answers[STATUS] = fk.status("failed", ts=fx.NOW_MS)
        job = fk.job(Q3_ONLY, created_at_ms=fx.NOW_MS)
        job["metadata"]["member_progress"] = progress

        outcome = await dispatch(job)

        assert outcome.outcome == DispatchOutcome.FAILED
        assert world.calls_of(APPLY) == 0

    @pytest.mark.asyncio
    async def test_apply_budget_count_survives_rate_limited_claim(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """``set_compute_job_progress`` replaces the stored block whole. A claim that is rate limited
        before it steps any quarter still writes a block, and that block must carry the count the
        previous claim stored, or the next claim reads zero and applies a second time."""
        monkeypatch.setattr(exchange_module, "OKX_BILLS_MAX_RETRIES", 1)
        world = _setup(monkeypatch)
        world.answers[STATUS] = fk.no_entry()
        world.answers[APPLY] = fk.apply_answer("false", ts=fx.NOW_MS)
        job = fk.job(Q3_ONLY, created_at_ms=fx.NOW_MS)

        first = await dispatch(job)
        assert first.outcome == DispatchOutcome.DEFERRED
        assert _quarter_applies(world) == [1]

        # Claim 2: account/config is rate limited before any quarter is stepped.
        job = world.reclaim(job)
        _set_clock(monkeypatch, fx.NOW_MS + HOUR_MS)

        def _limited(_inst: Any, _params: Any) -> Any:
            raise ccxt.RateLimitExceeded("too many requests")

        good_config = world.answers[CONFIG]
        world.answers[CONFIG] = _limited
        second = await dispatch(job)
        assert second.outcome == DispatchOutcome.DEFERRED
        assert _defers(world)[-1]["p_defer_seconds"] == RATE_LIMIT_DEFER_S
        assert _quarter_applies(world) == [1], "the rate-limited claim's block still carries the count"

        # Claim 3: read back from claim 2's block; OKX still shows no entry.
        job = world.reclaim(job)
        _set_clock(monkeypatch, fx.NOW_MS + 2 * HOUR_MS)
        world.answers[CONFIG] = good_config
        third = await dispatch(job)

        assert third.outcome == DispatchOutcome.DEFERRED
        assert world.calls_of(APPLY) == 1, "the apply total for the quarter stays one"
        assert _quarter_applies(world) == [1]

    @pytest.mark.asyncio
    async def test_apply_budget_rate_limited_apply_gives_the_count_back(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A rate limit on the apply POST is a refusal: no request exists at OKX. If the count stayed
        raised, the next claim would wait on "no entry, prior >= 1" until the job is old, stop
        ``archive_request_failed`` and start the 14-day cooldown for a request that never existed.
        So the count goes back to what it was, is STORED that way, and the next claim applies."""
        world = _setup(monkeypatch)
        world.answers[STATUS] = fk.no_entry()
        limited = {"on": True}

        def _answer(_inst: Any, _params: Any) -> Any:
            if limited["on"]:
                raise ccxt.RateLimitExceeded("too many requests")
            return fk.apply_answer("false", ts=fx.NOW_MS)

        world.answers[APPLY] = _answer
        job = fk.job(Q3_ONLY, created_at_ms=fx.NOW_MS)

        first = await dispatch(job)

        assert first.outcome == DispatchOutcome.DEFERRED
        assert _defers(world)[-1]["p_defer_seconds"] == RATE_LIMIT_DEFER_S
        assert world.calls_of(APPLY) == 1
        # Stored values, snapshotted from the writes (the recorded dicts are the live result).
        stored = [json.loads(json.dumps(w["p_progress"]))["quarters"][0]["applies"] for w in world.progress_writes()]
        assert stored[-1] == 0, "the stored count is given back, not left raised"

        limited["on"] = False
        job = world.reclaim(job)
        _set_clock(monkeypatch, fx.NOW_MS + HOUR_MS)
        second = await dispatch(job)

        assert second.outcome == DispatchOutcome.DEFERRED
        assert world.calls_of(APPLY) == 2, "the refused POST did not spend the quarter's apply"
        assert _quarter_applies(world) == [1]

    @pytest.mark.asyncio
    async def test_apply_count_is_stored_before_the_post(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A timeout on the apply POST is the textbook unknown outcome: the request may have landed.
        The raised count must already be STORED when the POST goes out, or the exception escapes
        with the count only in memory and the retry applies a second time. So the block is written
        before the POST, and after the timeout the next claim does not apply again."""
        world = _setup(monkeypatch)
        world.answers[STATUS] = fk.no_entry()
        stored_at_post: list[int] = []

        def _timeout(_inst: Any, _params: Any) -> Any:
            assert world.supabase is not None
            name, params = world.supabase.rpcs[-1]
            assert name == "set_compute_job_progress", "the last call before the POST is the count write"
            stored_at_post.append(params["p_progress"]["quarters"][0]["applies"])
            raise ccxt.RequestTimeout("timed out")

        world.answers[APPLY] = _timeout
        job = fk.job(Q3_ONLY, created_at_ms=fx.NOW_MS)

        first = await dispatch(job)

        assert first.outcome == DispatchOutcome.FAILED
        assert stored_at_post == [1]
        assert _quarter_applies(world) == [1], "an unknown outcome stays counted as spent"

        job = world.reclaim(job)
        _set_clock(monkeypatch, fx.NOW_MS + HOUR_MS)
        second = await dispatch(job)

        assert second.outcome == DispatchOutcome.DEFERRED
        assert world.calls_of(APPLY) == 1, "the stored count stopped a second apply"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("failure", ["raises", "fenced_no_op"])
    async def test_apply_is_not_posted_when_the_count_cannot_be_stored(
        self, monkeypatch: pytest.MonkeyPatch, failure: str
    ) -> None:
        """No POST goes out on a count that is not stored: the claim ends with the named transient
        ``fills_count_not_persisted`` and OKX's 12-a-day budget is untouched. Both ways a write can
        fail are covered: it raises, and it is a fenced no-op (the claim token was lost)."""
        world = _setup(monkeypatch)
        world.answers[STATUS] = fk.no_entry()
        assert world.supabase is not None
        if failure == "raises":
            world.supabase.rpc_errors["set_compute_job_progress"] = RuntimeError("db down")
        else:
            world.supabase.progress_returns = False

        outcome = await dispatch(fk.job(Q3_ONLY, created_at_ms=fx.NOW_MS))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_kind == "transient"
        assert outcome.error_message == (
            "okx_archive_rebuild: fills_count_not_persisted quarter=2026-Q3"
        )
        assert world.calls_of(APPLY) == 0
        assert world.instances[0].calls.count(APPLY) == 0

    @pytest.mark.asyncio
    async def test_dead_link_on_a_finished_quarter_reapplies_once_counted(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """OKX reports the quarter ``finished`` but its link is dead (links live about 5.5 h and the
        chain arrives later; the download's one fresh read returns the same dead link). Without a
        re-apply the quarter can never be read again inside OKX's retention, and every retry repeats
        the same ``link_expired``. The re-apply is a counted, stored apply on its own fresh client,
        and it stays inside ``FILLS_MAX_APPLIES_PER_QUARTER``: after the cap the stop is as before."""
        world = _setup(monkeypatch)
        world.answers[APPLY] = fk.apply_answer("false", ts=fx.NOW_MS)
        world.download_errors = [LinkExpired() for _ in range(2 * FILLS_MAX_APPLIES_PER_QUARTER + 2)]
        job = fk.job(Q3_ONLY, created_at_ms=fx.NOW_MS)

        outcomes = await _run_claims(
            world, monkeypatch, job, lambda _i: fk.finished("2026", "Q3"), claims=6
        )

        assert [o.outcome for o in outcomes] == [
            DispatchOutcome.DEFERRED,
            DispatchOutcome.DEFERRED,
            DispatchOutcome.FAILED,
        ]
        assert outcomes[-1].error_kind == "transient"
        assert outcomes[-1].error_message == (
            "okx_archive_rebuild: link_expired quarter=2026-Q3 cause=expired_twice"
        )
        assert world.calls_of(APPLY) == FILLS_MAX_APPLIES_PER_QUARTER
        assert len(_fresh_applies(world)) == FILLS_MAX_APPLIES_PER_QUARTER
        assert _quarter_applies(world) == [FILLS_MAX_APPLIES_PER_QUARTER]
        assert [p["p_defer_seconds"] for p in _defers(world)] == [MAX_DEFER_S] * 2  # the 2 h wait, clamped to the defer ceiling

    @pytest.mark.asyncio
    async def test_dead_link_reapply_is_stored_before_the_post_and_then_reads(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """After the re-apply OKX serves a live link and the next claim reads the quarter and ends
        DONE, with exactly one apply spent."""
        world = _setup(monkeypatch)
        world.answers[APPLY] = fk.apply_answer("false", ts=fx.NOW_MS)
        world.download_errors = [LinkExpired(), LinkExpired()]
        job = fk.job(Q3_ONLY, created_at_ms=fx.NOW_MS)

        outcomes = await _run_claims(
            world, monkeypatch, job, lambda _i: fk.finished("2026", "Q3"), claims=3
        )

        assert [o.outcome for o in outcomes] == [DispatchOutcome.DEFERRED, DispatchOutcome.DONE]
        assert world.calls_of(APPLY) == 1
        assert _quarter_applies(world) == [1]
        names = [name for kind, name in world.timeline if kind == "rpc" or name == APPLY]
        assert names.index(APPLY) > 0 and names[names.index(APPLY) - 1] == "set_compute_job_progress"

    @pytest.mark.asyncio
    async def test_download_network_failure_is_not_a_dead_link(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A transport failure while downloading says nothing about the link: it keeps the transient
        ``link_expired`` with no apply, or a flaky network would burn the quarter's apply budget."""
        world = _setup(monkeypatch)
        world.download_errors = [httpx.ConnectError("boom")]
        job = fk.job(Q3_ONLY, created_at_ms=fx.NOW_MS)

        outcome = await dispatch(job)

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message == (
            "okx_archive_rebuild: link_expired quarter=2026-Q3 cause=network"
        )
        assert world.calls_of(APPLY) == 0


class TestWaitEdges:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "answer",
        [
            ["a", "list", "not", "a", "mapping"],
            {"code": "0", "data": "not a list"},
            {"code": "0", "data": ["not a mapping"]},
            fk.status("weird", ts=fx.NOW_MS),
        ],
        ids=["answer_not_a_mapping", "data_not_a_list", "entry_not_a_mapping", "unknown_state"],
    )
    async def test_status_drift_is_archive_request_failed(
        self, monkeypatch: pytest.MonkeyPatch, answer: Any
    ) -> None:
        """OKX's answer is read against a closed vocabulary: anything else is contract drift and
        stops by name at once (waiting eight hours would only hide it), and drift is never read as
        "no entry", which would spend an apply."""
        world = _setup(monkeypatch)
        world.answers[STATUS] = answer

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message == "okx_archive_rebuild: archive_request_failed quarter=2026-Q2"
        assert world.calls_of(APPLY) == 0

    @pytest.mark.asyncio
    async def test_ongoing_past_give_up_is_archive_give_up(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        world = _setup(monkeypatch)
        world.answers[STATUS] = fk.status("ongoing", ts=fx.NOW_MS - (GIVE_UP_AFTER_S + 60) * 1000)

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_kind == "permanent"
        assert outcome.error_message == "okx_archive_rebuild: archive_give_up quarter=2026-Q2 age_h=8"
        assert world.calls_of(APPLY) == 0
        assert _defers(world) == []

    @pytest.mark.asyncio
    async def test_ongoing_without_a_readable_ts_is_archive_request_failed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Without OKX's ts there is no bound on the wait: refuse to wait unboundedly."""
        world = _setup(monkeypatch)
        world.answers[STATUS] = {"code": "0", "data": [{"state": "ongoing", "ts": "soon"}]}

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message == (
            "okx_archive_rebuild: archive_request_failed quarter=2026-Q2 state=ongoing"
        )

    @pytest.mark.asyncio
    async def test_backstop_ends_the_wait(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A job older than the 24 h backstop is not parked again: it ends in the named
        ``archive_give_up`` and writes its block once, whatever OKX says."""
        world = _setup(monkeypatch)
        world.answers[STATUS] = fk.status("ongoing", ts=fx.NOW_MS - HOUR_MS)
        old = fk.job(
            {"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS - (BACKSTOP_AFTER_S + 60) * 1000
        )

        outcome = await dispatch(old)

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message is not None
        assert outcome.error_message.startswith("okx_archive_rebuild: archive_give_up backstop age_h=")
        assert _defers(world) == []
        assert world.last_result()["stop_class"] == "archive_give_up"
        assert len(world.progress_writes()) == 1

    @pytest.mark.asyncio
    @pytest.mark.parametrize("exc_type", [ccxt.RateLimitExceeded, ccxt.DDoSProtection])
    @pytest.mark.parametrize("endpoint", [CONFIG, STATUS])
    async def test_rate_limit_defers_and_never_stamps_the_key(
        self, monkeypatch: pytest.MonkeyPatch, exc_type: type[Exception], endpoint: str
    ) -> None:
        """A venue rate limit is a reason to wait. It must never be stamped onto the key:
        ``stamp_api_key_429`` opens an exchange-wide breaker that pauses every normal OKX sync for a
        quota this job alone spent. The result block is written first."""
        monkeypatch.setattr(exchange_module, "OKX_BILLS_MAX_RETRIES", 1)
        world = _setup(monkeypatch)

        def _limited(_inst: Any, _params: Any) -> Any:
            raise exc_type("too many requests")

        world.answers[endpoint] = _limited

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS))

        assert outcome.outcome == DispatchOutcome.DEFERRED
        assert [p["p_defer_seconds"] for p in _defers(world)] == [RATE_LIMIT_DEFER_S]
        assert _defers(world)[0]["p_reason"] == "okx_archive_rebuild: waiting rate_limited"
        assert world.supabase is not None
        assert "stamp_api_key_429" not in [name for name, _ in world.supabase.rpcs]
        _progress_before_defer(world)
        assert world.calls_of(APPLY) == 0

    @pytest.mark.asyncio
    async def test_wait_never_sleeps_in_claim(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """OKX needs hours to generate a file. A claim that slept that out would hold a worker slot
        for hours, so every wait is a defer and the ONLY sleep in a claim is the pacing between two
        applies (one per ``MIN_APPLY_GAP_S``)."""
        slept: list[float] = []
        real_sleep = asyncio.sleep

        async def _recording_sleep(delay: float, *args: Any) -> None:
            if delay:
                slept.append(delay)
            await real_sleep(0)

        monkeypatch.setattr(asyncio, "sleep", _recording_sleep)
        world = _setup(monkeypatch, anchor_day="2026-02-23")
        world.answers[APPLY] = fk.apply_answer("false", ts=fx.NOW_MS)
        job = fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS)

        outcomes = await _run_claims(
            world,
            monkeypatch,
            job,
            lambda i: fk.no_entry() if i == 0 else fk.status("ongoing", ts=fx.NOW_MS),
            claims=3,
        )

        assert [o.outcome for o in outcomes] == [DispatchOutcome.DEFERRED] * 3
        assert world.calls_of(APPLY) == 3
        pacing = world.sleeps
        assert len(pacing) == 2, "the pacing sleeps once between two applies, not before the first"
        assert all(0 < gap <= MIN_APPLY_GAP_S for gap in pacing)
        assert sum(pacing) <= MIN_APPLY_GAP_S * world.calls_of(APPLY)
        assert slept == [], "no other sleep happens inside a claim"
        assert all(o.outcome != DispatchOutcome.DONE for o in outcomes)
        assert max(p["p_defer_seconds"] for p in _defers(world)) <= MAX_DEFER_S

    @pytest.mark.asyncio
    async def test_no_link_ts_or_amount_leaks(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The signed link is a bearer token and the request ts, amounts and tradeIds are the
        account's data: none may leave the worker's memory through a progress write, a defer reason,
        a log line (at ANY level) or an error text. Scanned over a wait run (no entry, ongoing) and a
        finished run."""
        caplog.set_level(logging.DEBUG)
        apply_ts, status_ts = "1795779123456", "1795778765432"
        world = _setup(monkeypatch)
        world.answers[APPLY] = fk.apply_answer("false", ts=int(apply_ts))
        job = fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS)
        texts: list[str] = []

        def _status_for(index: int) -> Any:
            return (
                fk.no_entry()
                if index == 0
                else fk.status("ongoing", ts=int(status_ts))
                if index == 1
                else lambda _inst, params: fk.finished(
                    params["year"], params["quarter"], ts=int(status_ts)
                )
            )

        outcomes = await _run_claims(world, monkeypatch, job, _status_for, claims=3)

        assert [o.outcome for o in outcomes] == [
            DispatchOutcome.DEFERRED, DispatchOutcome.DEFERRED, DispatchOutcome.DONE,
        ]
        texts += [json.dumps(world.progress_writes()), json.dumps(_defers(world)), caplog.text]
        texts += [repr(o) + str(o.error_message) for o in outcomes]
        everything = "\n".join(texts)

        scanned: list[str] = [*fk.LINK_SECRETS, apply_ts, status_ts, str(fk.REQUEST_TS_MS)]
        scanned += list(fx.EXPECTED_ROWS)  # the tradeIds
        for row in fx.EXPECTED_ROWS.values():
            scanned += [row["price"], row["cost"]]
        scanned += list(fx.QUARTER_BALANCES.values())
        for needle in scanned:
            assert needle not in everything, f"{needle!r} leaked into a progress write, defer or log"


# ---------------------------------------------------------------------------
# Task 3: targets, D-02 and the input contract
# ---------------------------------------------------------------------------

KEY_2 = "55555555-5555-4555-8555-555555555555"
KEY_3 = "66666666-6666-4666-8666-666666666666"
KEY_4 = "77777777-7777-4777-8777-777777777777"
STRATEGY_3 = "88888888-8888-4888-8888-888888888888"
STRATEGY_4 = "99999999-9999-4999-8999-999999999999"
STRATEGY_5 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


class TestTargets:
    @pytest.mark.asyncio
    async def test_targets_same_account_connected_only(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """One account's file serves every strategy whose key reads that account, and ONLY those: a
        strategy of another account, an archived one, or one on a disconnected key must neither be
        written for nor widen the quarters read (each of the three has an early anchor here, so
        including it would add Q1 and a fourth and fifth strategy)."""
        early = "2026-02-23"
        world = fk.install(
            monkeypatch,
            keys=[
                fk.key(),
                fk.key(KEY_2),
                fk.key(KEY_3, is_active=False, disconnected_at="2026-11-01T00:00:00+00:00"),
                fk.key(KEY_4, venue_account_id="U2"),
            ],
            strategies=[
                fk.strategy(STRATEGY_ID, fk.KEY_ID),
                fk.strategy(STRATEGY_2_ID, KEY_2),
                fk.strategy(STRATEGY_3, fk.KEY_ID, status="archived"),
                fk.strategy(STRATEGY_4, KEY_3),
                fk.strategy(STRATEGY_5, KEY_4),
            ],
            daily_returns=[
                {"strategy_id": STRATEGY_ID, "date": fx.ANCHOR_DAY},
                {"strategy_id": STRATEGY_2_ID, "date": "2026-10-01"},
                {"strategy_id": STRATEGY_3, "date": early},
                {"strategy_id": STRATEGY_4, "date": early},
                {"strategy_id": STRATEGY_5, "date": early},
            ],
            trades=[fx.stored_row(t, strategy_id=STRATEGY_ID) for t in fx.TRADE_IDS_RECONCILE_WINDOW],
            now_ms=fx.NOW_MS,
            today=TODAY_DATE,
        )

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS))

        assert outcome.outcome == DispatchOutcome.DONE
        result = world.result()
        # Position 0 is S1 (the lower id) and position 1 is S2: the states say which is which.
        assert [(t["position"], t["state"]) for t in result["strategies"]] == [
            (0, "read"), (1, "anchor_in_reach"),
        ]
        assert [(q["year"], q["quarter"]) for q in result["quarters"]] == [(2026, "Q2"), (2026, "Q3")]
        assert result["info"]["targets_skipped_disconnected"] == 1
        dumped = json.dumps(result)
        for excluded in (STRATEGY_3, STRATEGY_4, STRATEGY_5):
            assert excluded not in dumped

    @pytest.mark.asyncio
    async def test_blank_stored_uid_stops_before_decrypt(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A job key with no stored account id cannot be tied to an account: the job stops before any
        credential is decrypted or any client built, rather than reading whichever account the key
        happens to open."""
        world = fk.install(
            monkeypatch,
            keys=[fk.key(venue_account_id=None)],
            strategies=[fk.strategy()],
            daily_returns=[{"strategy_id": STRATEGY_ID, "date": fx.ANCHOR_DAY}],
            trades=[],
            now_ms=fx.NOW_MS,
            today=TODAY_DATE,
        )

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message == "okx_archive_rebuild: account_mismatch stored_uid=missing"
        assert world.decrypts == 0 and world.constructions == 0
        assert world.all_calls == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("key_row", "stop_class"),
        [
            (fk.key(exchange="bybit"), "key_not_okx"),
            (fk.key(is_active=False, disconnected_at="2026-11-01T00:00:00+00:00"), "key_disconnected"),
        ],
        ids=["not_okx", "disconnected"],
    )
    async def test_job_key_not_okx_or_disconnected(
        self, monkeypatch: pytest.MonkeyPatch, key_row: dict[str, Any], stop_class: str
    ) -> None:
        world = fk.install(
            monkeypatch,
            keys=[key_row],
            strategies=[fk.strategy()],
            daily_returns=[{"strategy_id": STRATEGY_ID, "date": fx.ANCHOR_DAY}],
            trades=[],
            now_ms=fx.NOW_MS,
            today=TODAY_DATE,
        )

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message == f"okx_archive_rebuild: {stop_class}"
        assert world.all_calls == [] and world.decrypts == 0 and world.constructions == 0

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("config", "stop_class"),
        [
            (
                {"code": "0", "data": [{"uid": "U9", "perm": "read_only,trade", "acctLv": "2"}]},
                "account_mismatch",
            ),
            (
                {"code": "0", "data": [{"uid": "U1", "perm": "trade", "acctLv": "2"}]},
                "perm_not_read_only",
            ),
        ],
        ids=["uid_mismatch", "not_read_only"],
    )
    async def test_uid_mismatch_and_read_only(
        self, monkeypatch: pytest.MonkeyPatch, config: dict[str, Any], stop_class: str
    ) -> None:
        """The live account must be the stored one and the key read-only, checked before the first
        archive call: reading the wrong account would write one strategy from another's ledger."""
        world = _setup(monkeypatch)
        world.answers[CONFIG] = config

        outcome = await dispatch(fk.job({"mode": "fills_calibrate"}, created_at_ms=fx.NOW_MS))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message == f"okx_archive_rebuild: {stop_class}"
        assert world.calls_of(STATUS) == 0 and world.calls_of(APPLY) == 0
        assert world.downloads == []


class TestInput:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "metadata",
        [
            {"quarters": [{"year": 2026, "quarter": "Q4"}]},
            {"quarters": [{"year": 2025, "quarter": f"Q{n}"} for n in (1, 2, 3, 4)]
             + [{"year": 2026, "quarter": "Q1"}]},
            {"quarters": [{"year": 2026, "quarter": "Q2"}, {"year": 2026, "quarter": "Q2"}]},
            {"quarters": [{"year": 2020, "quarter": "Q4"}]},
            {"quarters": [{"year": 2026, "quarter": "Q2", "extra": 1}]},
            {"quarters": [{"year": True, "quarter": "Q2"}]},
            {"quarters": "2026-Q2"},
            {"quarters": [{"year": 2026, "quarter": "Q5"}]},
            {"fill_strategy_ids": ["not-a-uuid"]},
            {"fill_strategy_ids": [STRATEGY_3]},
            {"fill_strategy_ids": []},
        ],
        ids=[
            "quarter_not_over", "more_than_four", "duplicate", "year_2020", "extra_key", "bool_year",
            "not_a_list", "bad_label", "not_a_uuid", "uuid_not_on_account", "empty_ids",
        ],
    )
    async def test_invalid_fills_input(
        self, monkeypatch: pytest.MonkeyPatch, metadata: dict[str, Any]
    ) -> None:
        """Malformed input stops ``invalid_input`` before any key is decrypted or OKX is called:
        an operator's typo must never turn into a request against someone's exchange account."""
        world = _setup(monkeypatch)

        outcome = await dispatch(
            fk.job({"mode": "fills_calibrate", **metadata}, created_at_ms=fx.NOW_MS)
        )

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_message == "okx_archive_rebuild: invalid_input"
        assert world.all_calls == []
        assert world.decrypts == 0 and world.constructions == 0

    @pytest.mark.asyncio
    async def test_unknown_metadata_key_is_accepted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The platform adds its own keys to ``compute_jobs.metadata``: an unknown one is ignored."""
        world = _setup(monkeypatch)

        outcome = await dispatch(
            fk.job({"mode": "fills_calibrate", "correlation_id": "abc"}, created_at_ms=fx.NOW_MS)
        )

        assert outcome.outcome == DispatchOutcome.DONE
        assert world.result()["stop_class"] is None
