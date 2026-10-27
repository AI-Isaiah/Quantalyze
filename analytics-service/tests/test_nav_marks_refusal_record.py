"""Phase 174 MARKPAUSE plan 02 - a refused mark's token and first-seen day are kept privately (SC-2, SC-3, D-02, D-03, L3).

What these pin, and why each can fail
-------------------------------------
When a derive's mark read is refused (``build_mark_read`` returns a token from the closed set
``MARK_REFUSAL_TOKENS``), nothing is stored in ``api_key_nav_marks`` and the derive carries on
(NAVMTM L3). Before this phase the token survived only in a log line (strategy mode) or in the
key-mode ``key_inputs`` payload with no first-seen day. D-02 keeps it where only the key's owner
(or an admin, through the service role) can read it: ``allocator_equity_derived``
``kind = "nav_mark_refusal:<api_key_id>"``, payload ``{token, first_seen_day, last_seen_day}``,
and NEVER in ``strategy_analytics.data_quality_flags``, which is publicly readable for a published
strategy (REVIEW-2 WR-04).

The in-memory ``AedDb`` below is a hand-written MIRROR of ``allocator_equity_derived``: the unique
key ``(allocator_id, kind)`` and the PostgREST surface the worker uses (upsert with
``on_conflict``, select/eq/limit, delete/eq). Like every fake it can drift from the table; the
table's grants and policies are covered by the SQL gates. Every expected day is a literal typed
beside the ``mark_day_for`` arithmetic (a read at 00:10Z on the 8th labels the 7th).
"""
from __future__ import annotations

import logging
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from services.job_worker import DispatchOutcome
from services.nav_marks import MARK_REFUSAL_TOKENS, NAV_MARK_REFUSAL_KIND_PREFIX
from tests.test_nav_marks_derive_apply import (  # noqa: F401  (autouse: re-binds the real writer)
    KEY,
    STRATEGY,
    USER,
    REALIZED_THROUGH_0305,
    StrategyDb,
    _real_marks_writer,
    at_0010,
    derive_ccxt_strategy,
    prestamp,
    series,
)
from tests.test_nav_marks_l4_read import (
    CLOSED_DAY as L4_CLOSED_DAY,
    KEY as L4_KEY,
    _bybit,
    _derive as _derive_l4,
)
from tests.test_nav_marks_writer import FakeDb, T_0010, _derive_okx

AED = "allocator_equity_derived"


class AedDb:
    """``allocator_equity_derived`` keyed ``(allocator_id, kind)``."""

    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], dict[str, Any]] = {}
        self.upserts: list[dict[str, Any]] = []
        self.deletes: list[dict[str, Any]] = []
        self.fail_refusal_upsert: Exception | None = None
        self.fail_refusal_delete: Exception | None = None

    def refusals(self) -> dict[tuple[str, str], dict[str, Any]]:
        """The refusal-family rows only (the key-mode derive writes its own ``key_inputs`` row)."""
        return {
            k: v["payload"] for k, v in self.rows.items()
            if k[1].startswith(NAV_MARK_REFUSAL_KIND_PREFIX)
        }


class _Res:
    def __init__(self, data: Any) -> None:
        self.data = data


class _AedQuery:
    def __init__(self, db: AedDb) -> None:
        self._db = db
        self._eq: dict[str, Any] = {}
        self._mode = "select"

    def upsert(self, row: dict[str, Any], on_conflict: str | None = None, **_kw: Any) -> "_AedQuery":
        assert on_conflict == "allocator_id,kind"
        self._mode = "upsert"
        self._row = row
        return self

    def select(self, _cols: str) -> "_AedQuery":
        self._mode = "select"
        return self

    def delete(self, **_kw: Any) -> "_AedQuery":
        self._mode = "delete"
        return self

    def eq(self, col: str, val: Any) -> "_AedQuery":
        self._eq[col] = val
        return self

    def limit(self, _n: int) -> "_AedQuery":
        return self

    def execute(self) -> _Res:
        db = self._db
        if self._mode == "upsert":
            row = self._row
            if db.fail_refusal_upsert is not None and str(row["kind"]).startswith(
                NAV_MARK_REFUSAL_KIND_PREFIX
            ):
                raise db.fail_refusal_upsert
            db.upserts.append(row)
            db.rows[(row["allocator_id"], row["kind"])] = dict(row)
            return _Res([row])
        matched = [
            v for v in db.rows.values() if all(v[c] == x for c, x in self._eq.items())
        ]
        if self._mode == "delete":
            if db.fail_refusal_delete is not None and str(self._eq.get("kind", "")).startswith(
                NAV_MARK_REFUSAL_KIND_PREFIX
            ):
                raise db.fail_refusal_delete
            db.deletes.append(dict(self._eq))
            for v in matched:
                del db.rows[(v["allocator_id"], v["kind"])]
            return _Res(matched)
        return _Res(matched)


def _route_aed(ctx: MagicMock, db: AedDb) -> MagicMock:
    inner = ctx.supabase.table.side_effect

    def _routed(name: str) -> Any:
        return _AedQuery(db) if name == AED else inner(name)

    ctx.supabase.table.side_effect = _routed
    return ctx


@pytest.fixture
def aed(monkeypatch: pytest.MonkeyPatch) -> AedDb:
    """Route ``allocator_equity_derived`` to the mirror in the strategy-mode harness."""
    import tests.test_nav_marks_derive_apply as apply_mod
    import tests.test_nav_marks_writer as writer_mod

    db = AedDb()
    real_build = apply_mod._build_ctx

    def _build(**kw: Any) -> tuple[MagicMock, dict[str, Any]]:
        ctx, capture = real_build(**kw)
        return _route_aed(ctx, db), capture

    # Both harnesses build their ctx through the module-level ``_build_ctx`` they imported, so
    # re-binding it on each routes ``allocator_equity_derived`` to the mirror for strategy mode
    # (``derive_ccxt_strategy``) and for key mode and the Bybit harness (``_derive_okx``, ``_derive``).
    monkeypatch.setattr(apply_mod, "_build_ctx", _build)
    monkeypatch.setattr(writer_mod, "_build_ctx", _build)
    return db


REFUSED_DAY_0307 = "2026-03-07"  # a read at 00:10Z on 03-08 labels 03-07
REFUSED_DAY_0308 = "2026-03-08"  # a read at 00:10Z on 03-09 labels 03-08


@pytest.mark.asyncio
async def test_a_refused_strategy_mark_is_recorded_privately(aed: AedDb) -> None:
    """OKX strategy mode, the venue read flagged ``balance_error``: ``build_mark_read`` refuses with
    that token, nothing is stored in ``api_key_nav_marks``, and the token plus the closed day
    (00:10Z on 03-08 labels 03-07) land on ONE owner-scoped ``nav_mark_refusal:<key id>`` row."""
    db = StrategyDb()
    result, capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"), balance_error=True
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks == {}, "a refused read stores no mark"
    assert aed.refusals() == {
        (USER, "nav_mark_refusal:" + KEY): {
            "token": "balance_error",
            "first_seen_day": REFUSED_DAY_0307,
            "last_seen_day": REFUSED_DAY_0307,
        }
    }
    assert "marks_since" not in prestamp(capture), "no mark was applied, so the flags say nothing of marks"


def _strings_in(value: Any) -> Iterator[str]:
    """Every dict key and every string value, recursively."""
    if isinstance(value, dict):
        for k, v in value.items():
            yield str(k)
            yield from _strings_in(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _strings_in(v)
    elif isinstance(value, str):
        yield value


def _public_flag_strings(capture: dict[str, Any]) -> list[str]:
    """Every string in every ``strategy_analytics`` upsert's ``data_quality_flags``."""
    out: list[str] = []
    seen = 0
    for name, payload, _oc in capture["upserts"]:
        if name == "strategy_analytics" and isinstance(payload, dict):
            seen += 1
            out.extend(_strings_in(payload.get("data_quality_flags")))
    assert seen >= 1, "the derive must have upserted strategy_analytics for this pin to mean anything"
    return out


@pytest.mark.asyncio
async def test_a_second_refusal_keeps_the_first_seen_day(aed: AedDb) -> None:
    """Refused 00:10Z on 03-08 (labels 03-07), then again 00:10Z on 03-09 (labels 03-08): ONE row,
    ``first_seen_day`` still 03-07, ``last_seen_day`` moved to 03-08. A later refusal under another
    token moves the token (patched ``build_mark_read``: one real refusal reason cannot be swapped for
    another on the same fixture) and still keeps the first-seen day."""
    await derive_ccxt_strategy(
        StrategyDb(), returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"),
        balance_error=True,
    )
    await derive_ccxt_strategy(
        StrategyDb(), returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-09"),
        balance_error=True,
    )
    key = (USER, "nav_mark_refusal:" + KEY)
    assert aed.refusals() == {
        key: {"token": "balance_error", "first_seen_day": "2026-03-07", "last_seen_day": "2026-03-08"}
    }
    with patch("services.job_worker.build_mark_read", return_value="dust"):
        await derive_ccxt_strategy(
            StrategyDb(), returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-10"),
        )
    assert aed.refusals() == {
        key: {"token": "dust", "first_seen_day": "2026-03-07", "last_seen_day": "2026-03-09"}
    }


@pytest.mark.asyncio
async def test_a_stored_mark_clears_the_record(aed: AedDb) -> None:
    """Refused 00:10Z on 03-08, then a healthy derive 00:10Z on 03-09 stores 03-08's mark (equity
    1071.0, upl 71.0): the key marks again, so no refusal row is left."""
    db = StrategyDb()
    await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"), balance_error=True
    )
    assert len(aed.refusals()) == 1
    result, _capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-09")
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks[(KEY, "2026-03-08")]["nav_usd"] == 1071.0
    assert aed.refusals() == {}


@pytest.mark.asyncio
async def test_a_mark_found_already_stored_clears_the_record(aed: AedDb) -> None:
    """Bybit marks come from the anchor's own reading; a derive that FINDS the day's mark already
    stored (W3: it skips its read and returns that row) clears the record too. A refusal row is
    planted, then the first derive stores the mark (clears it), the row is planted again, and the
    second derive finds the stored mark and must clear it again."""
    marks = FakeDb()
    planted = {"token": "balance_error", "first_seen_day": "2026-02-27", "last_seen_day": "2026-02-28"}
    key = ("alloc-1", "nav_mark_refusal:" + L4_KEY)

    def _plant() -> None:
        aed.rows[key] = {"allocator_id": "alloc-1", "kind": key[1], "payload": dict(planted)}

    _plant()
    first, _c, _m = await _derive_l4(marks, _bybit(), venue="bybit")
    assert first.outcome == DispatchOutcome.DONE
    assert (L4_KEY, L4_CLOSED_DAY) in marks.marks and aed.refusals() == {}
    _plant()
    second, _c, _m = await _derive_l4(marks, _bybit(), venue="bybit")
    assert second.outcome == DispatchOutcome.DONE
    assert aed.refusals() == {}, "the found-mark path must clear the record too"


@pytest.mark.asyncio
async def test_a_refused_key_mode_derive_writes_the_same_row(aed: AedDb) -> None:
    """Key mode reaches the same seam: 00:10:30Z on 03-02 labels 03-01. The existing
    ``key_inputs`` echo of the token is kept beside the new row (the compose reads it)."""
    marks = FakeDb()
    result, _capture = await _derive_okx(marks, now=T_0010, balance_error=True, key_mode=True)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert aed.refusals() == {
        ("alloc-1", "nav_mark_refusal:key-1"): {
            "token": "balance_error", "first_seen_day": "2026-03-01", "last_seen_day": "2026-03-01",
        }
    }
    key_inputs = aed.rows[("alloc-1", "key_inputs:key-1")]["payload"]
    assert key_inputs["nav_mark_refusal"] == "balance_error"


@pytest.mark.asyncio
@pytest.mark.parametrize("token", sorted(MARK_REFUSAL_TOKENS))
async def test_no_refusal_token_reaches_public_flags(aed: AedDb, token: str) -> None:
    """SC-2, SC-3 and T-174-05: whichever token the mark read is refused with, no
    ``strategy_analytics`` upsert carries it in ``data_quality_flags`` (keys or values, recursively),
    while the owner-only row does. ``build_mark_read`` is patched to return the token because one OKX
    fixture cannot reach every one of the closed set naturally (the Bybit-only and option-value
    tokens need their own venue reads); the boundary under test is where the seam WRITES a token, and
    that is the same code for every token. The derive's own read is healthy, so no
    ``anchor_null_reason`` word legitimately shares a token's name."""
    with patch("services.job_worker.build_mark_read", return_value=token):
        result, capture = await derive_ccxt_strategy(
            StrategyDb(), returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"),
        )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    leaked = [t for t in _public_flag_strings(capture) if token in t]
    assert leaked == [], "a refusal token reached the public data_quality_flags"
    assert aed.refusals() == {
        (USER, "nav_mark_refusal:" + KEY): {
            "token": token, "first_seen_day": "2026-03-07", "last_seen_day": "2026-03-07",
        }
    }


@pytest.mark.asyncio
async def test_a_failed_record_write_does_not_change_the_derive(
    aed: AedDb, caplog: pytest.LogCaptureFixture
) -> None:
    """NAVMTM L3: a refusal never fails a derive, and neither does the note of it. The same refused
    derive runs twice, once with a healthy record write and once with the refusal-kind upsert
    raising: outcome, ``csv_daily_returns`` rows and the ``strategy_analytics`` flags are equal, and
    the failure logs ONE warning naming the exception class and not its message."""
    ok_db = StrategyDb()
    ok, ok_capture = await derive_ccxt_strategy(
        ok_db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"), balance_error=True
    )
    assert len(aed.refusals()) == 1
    aed.rows.clear()
    aed.fail_refusal_upsert = RuntimeError("db exploded with a private detail")

    bad_db = StrategyDb()
    with caplog.at_level(logging.WARNING, logger="services.job_worker"):
        bad, bad_capture = await derive_ccxt_strategy(
            bad_db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"),
            balance_error=True,
        )
    assert bad.outcome == ok.outcome == DispatchOutcome.DONE
    assert bad_db.rows() == ok_db.rows()
    assert prestamp(bad_capture) == prestamp(ok_capture)
    assert aed.refusals() == {}
    warned = [r.getMessage() for r in caplog.records if "refusal not recorded" in r.getMessage()]
    assert len(warned) == 1
    assert "RuntimeError" in warned[0]
    assert "private detail" not in warned[0] and "balance_error" not in warned[0]


@pytest.mark.asyncio
async def test_a_failed_record_delete_does_not_change_the_derive(
    aed: AedDb, caplog: pytest.LogCaptureFixture
) -> None:
    """NAVMTM L3, clearer side: refused 03-08, then a healthy derive on 03-09 stores 03-08's mark and
    clears the record. The same pair of derives runs with the refusal-kind delete raising: the
    outcome, the stored mark and the derive's rows are equal, the stale row stays, and the failure
    logs ONE warning naming the key and the exception class and not its message."""
    ok_db = StrategyDb()
    await derive_ccxt_strategy(
        ok_db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"), balance_error=True
    )
    ok, _ok_capture = await derive_ccxt_strategy(
        ok_db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-09")
    )
    assert aed.refusals() == {}
    aed.rows.clear()

    bad_db = StrategyDb()
    await derive_ccxt_strategy(
        bad_db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"), balance_error=True
    )
    assert len(aed.refusals()) == 1
    aed.fail_refusal_delete = RuntimeError("db exploded with a private detail")
    with caplog.at_level(logging.WARNING, logger="services.job_worker"):
        bad, _bad_capture = await derive_ccxt_strategy(
            bad_db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-09")
        )
    assert bad.outcome == ok.outcome == DispatchOutcome.DONE, bad.error_message
    assert bad_db.marks[(KEY, "2026-03-08")]["nav_usd"] == 1071.0
    assert bad_db.rows() == ok_db.rows()
    assert len(aed.refusals()) == 1, "the stale row is what a failed clear leaves behind"
    warned = [r.getMessage() for r in caplog.records if "refusal not cleared" in r.getMessage()]
    assert len(warned) == 1
    assert "RuntimeError" in warned[0] and KEY in warned[0]
    assert "private detail" not in warned[0]


_RUNBOOK = Path(__file__).resolve().parents[2] / "docs" / "runbooks" / "navmtm-chain-move-go-live.md"


def _runbook_readout_sql() -> str:
    """The SQL block under the runbook's "Mark refusals (Phase 174)" section."""
    md = _RUNBOOK.read_text(encoding="utf-8")
    section = re.search(r"^## Mark refusals \(Phase 174\)\n(.*?)(?=^## )", md, re.S | re.M)
    assert section is not None, "the runbook lost its Mark refusals (Phase 174) section"
    block = re.search(r"```sql\n(.*?)\n```", section.group(1), re.S)
    assert block is not None, "the Mark refusals section lost its SQL readout"
    return block.group(1)


def test_the_runbook_readout_selects_the_worker_prefix() -> None:
    """D-03: the readout is only worth having if it reads the rows the worker writes. It must select
    by the worker's own kind prefix (``NAV_MARK_REFUSAL_KIND_PREFIX + '%'``) and must not select
    ``allocator_id`` or the kind (which carries the key id): the readout is counts and token/day
    fields only (T-174-06). MR-02: it joins to the keys a derive can still reach, so a departed key's
    row is not counted as a refused key."""
    sql = _runbook_readout_sql()
    assert "'" + NAV_MARK_REFUSAL_KIND_PREFIX + "%'" in sql
    select_lists = re.findall(r"SELECT(.*?)\bFROM\b", sql, re.S | re.I)
    assert select_lists and not any(
        re.search(r"\b(kind|allocator_id)\b", lst) for lst in select_lists
    )
    assert "JOIN public.api_keys" in sql
    for eligible in ("disconnected_at IS NULL", "IS DISTINCT FROM 'revoked'", "ak.is_active"):
        assert eligible in sql, "the readout lost an api_keys eligibility predicate: " + eligible
    for field in ("token", "first_seen_day", "last_seen_day"):
        assert "payload->>'" + field + "'" in sql
