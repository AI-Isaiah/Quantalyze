"""Phase 166.3.1 NAVBREACH plan 01 — tests for ``scripts/navbreach_anchor_probe.py``.

The probe is a read-only, redaction-safe measurement of WHY a Deribit composite
member's ``native_nav`` inception gate breaches (D-01): is the venue anchor
``equity`` carrying a realized session term the ledger books only at the 08:00 UTC
settlement (H1), or is the venue's data wrong (H3)?

Every ledger below is built through the REAL ``build_deribit_native_ledger`` seam
and every verdict through the REAL ``combine_native_ledger`` gate; only the venue
is a stub. Nothing here proves the mechanism is the live one, that is the
recorded probe run. What these tests prove is that the probe can SEE the
mechanism, that it attributes a closure to one term, and that its output cannot
carry an amount.

Why each group matters (Rule 9):
  * decomposition / gate verdicts: a probe that cannot tell "the realized term
    closes it" from "the options term closes it" from "nothing closes it" cannot
    pick between H1, H1b and H3, which is the whole purpose of wave 1.
  * quiet: a run with no unbooked realized PnL passes today's gate too, so it
    proves nothing about a fix (RESEARCH Pitfall 1); the record must say so.
  * field-absent: a venue field the summary lacks must never read as 0.0, or a
    renamed field would look like "the realized term is zero, H1 is refuted".
  * redaction: the output is pasted into a tracked file in a public repo. An
    amount, an id or a finer-than-day timestamp there is a disclosure.
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

from scripts import navbreach_anchor_probe as nb
from services import deribit_ingest as di
from services.deribit_ingest import LedgerCompletenessError
from tests.test_deribit_ingest import (
    _NativeAnchorStub,
    _btc_deposit,
    _btc_option_trade,
    _btc_summary,
    _jul_ms,
    _patch_jul_index,
    _patch_pipeline,
)

_NOW = datetime(2026, 10, 8, 10, 30, tzinfo=timezone.utc)
_PROBE_SRC = Path(nb.__file__).read_text(encoding="utf-8")

# Distinctive amounts, so a substring search for one in the output cannot be
# confused with a ratio's digits.
_DEPOSIT = 1.2345
_SETTLE = -0.0113
_UPL = 0.3047
_RPL = 0.4083
_BOOKED = round(_DEPOSIT + _SETTLE, 4)
_EQUITY = round(_BOOKED + _UPL + _RPL, 4)


def _perp_rows(extra: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = [
        _btc_deposit(10, change=_DEPOSIT),
        {
            "type": "settlement",
            "instrument_name": "BTC-PERPETUAL",
            "currency": "BTC",
            "change": _SETTLE,
            "index_price": 60000.0,
            "timestamp": _jul_ms(11, 8),
        },
    ]
    return rows + (extra or [])


def _summary(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "currency": "BTC",
        "equity": _EQUITY,
        "balance": _BOOKED,
        "futures_session_upl": _UPL,
        "futures_session_rpl": _RPL,
        "options_session_upl": 0.0,
        "options_value": 0.0,
        "session_funding": 0.0,
    }
    base.update(over)
    return base


async def _ledger(
    monkeypatch: Any,
    summaries: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    *,
    basis: str = "cash_settlement",
) -> tuple[Any, frozenset[str]]:
    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        return rows if currency == "BTC" else []

    _patch_pipeline(
        monkeypatch,
        scopes=[di.Scope("main", None, True)],
        currencies={"main": ["BTC"]},
        paginate=_paginate,
    )
    _patch_jul_index(monkeypatch)
    ex = _NativeAnchorStub(summaries=summaries, index_price={"BTC": 60000.0})
    ledger, report = await di.build_deribit_native_ledger(ex, pnl_basis=basis)
    return ledger, report.indexable_currencies


def _pre_wedgefix(ledger: Any, wedge: dict[str, float]) -> Any:
    """The same ledger carrying the cash-basis terminal wedge the worker shipped
    BEFORE DERIBITWEDGE (``session uPnL + options_value``, no realized term), given
    as a literal so the oracle does not depend on the probe's own arithmetic.

    The probe measures whatever wedge the ledger carries. Since DERIBITWEDGE the
    shipped cash wedge is ``equity - balance``, which already strips the realized
    term, so a probe run on today's code sees the H1 mechanism only on a ledger
    that still carries the old wedge. That is the ledger the recorded probe runs
    (``166.3.1-PROBE-RECORD.md``) measured."""
    return dataclasses.replace(ledger, terminal_upnl_native=dict(wedge))


def _ratio(verdict: str) -> float:
    assert verdict.startswith("breach:"), verdict
    return float(verdict.split(":", 1)[1])


# ---------------------------------------------------------------------------
# Decomposition and gate verdicts.
# ---------------------------------------------------------------------------


async def test_unbooked_realized_term_breaches_today_and_one_term_closes_it(
    monkeypatch: Any,
) -> None:
    """The headline mechanism: equity carries a futures session RPL the ledger has
    not booked. The pre-DERIBITWEDGE wedge breaches; every candidate that strips
    the realized term closes it; the residual equals that term; ``balance`` is the
    anchor. The shipped wedge (``equity - balance``) closes it too: that is the
    DERIBITWEDGE fix NAVBREACH plan 03 was absorbed into (D-07)."""
    summaries = [_summary()]
    shipped, indexable = await _ledger(monkeypatch, summaries, _perp_rows())
    (now_rec,) = nb.measure_member(
        summaries, {"cash_settlement": shipped}, indexable, 0, _NOW
    )
    assert now_rec["gate_today"] == "pass"
    assert now_rec["currencies"][0]["resid_is_dust"] is True
    # The realized-term candidate is anchored on the pre-fix wedge, never on the
    # shipped one: added to ``equity - balance`` it would count the term twice.
    assert now_rec["gate_candidate_rpl_only"] == "pass"

    ledger = _pre_wedgefix(shipped, {"BTC": _UPL})
    (rec,) = nb.measure_member(
        summaries, {"cash_settlement": ledger}, indexable, 0, _NOW
    )
    assert _ratio(rec["gate_today"]) > 1.0
    assert rec["gate_candidate_rpl_only"] == "pass"
    assert rec["gate_candidate_full"] == "pass"
    assert rec["gate_candidate_balance"] == "pass"
    ccy = rec["currencies"][0]
    assert ccy["ccy"] == "BTC"
    assert ccy["resid_over_futures_session_rpl"] == pytest.approx(1.0, abs=5e-3)
    assert ccy["resid_is_dust"] is False
    assert rec["candidate_anchor_equals_balance"] is True
    assert rec["quiet"] is False
    assert rec["rpl_spelling_used"] == "futures_session_rpl"
    assert rec["gate_candidate_rpl_only_preanchor"] == "not-run"


async def test_quiet_session_every_verdict_passes_and_is_marked_quiet(
    monkeypatch: Any,
) -> None:
    """No unbooked realized PnL: today's gate passes too, so the run proves nothing
    about a fix. The record must say quiet so it is never cited as proof."""
    summaries = [_summary(futures_session_rpl=0.0, equity=round(_BOOKED + _UPL, 4))]
    ledger, indexable = await _ledger(monkeypatch, summaries, _perp_rows())
    (rec,) = nb.measure_member(
        summaries, {"cash_settlement": ledger}, indexable, 0, _NOW
    )
    for gate in (
        "gate_today",
        "gate_candidate_rpl_only",
        "gate_candidate_full",
        "gate_candidate_balance",
    ):
        assert rec[gate] == "pass", gate
    assert rec["quiet"] is True
    assert rec["currencies"][0]["resid_over_futures_session_rpl"] is None
    assert rec["currencies"][0]["resid_is_dust"] is True


async def test_mark_to_market_perp_member_behaves_like_cash(monkeypatch: Any) -> None:
    summaries = [_summary()]
    ledger, indexable = await _ledger(
        monkeypatch, summaries, _perp_rows(), basis="mark_to_market"
    )
    (rec,) = nb.measure_member(
        summaries, {"mark_to_market": ledger}, indexable, 0, _NOW
    )
    assert rec["basis"] == "mark_to_market"
    assert _ratio(rec["gate_today"]) > 1.0
    assert rec["gate_candidate_rpl_only"] == "pass"
    assert rec["gate_candidate_full"] == "pass"


async def test_options_session_term_is_attributed_only_by_the_full_candidate(
    monkeypatch: Any,
) -> None:
    """H1b: an open options book whose equity follows the documented identity (no
    options-session term). Stripping the realized term alone leaves the cash-basis
    wedge over-stripped by ``options_session_upl``; only the explicit-terms
    candidate closes it. This is what lets the record attribute a closure to one
    term instead of to "something in the wedge"."""
    summaries = [
        {
            "currency": "BTC",
            "equity": 2.9,
            "balance": 2.0,
            "futures_session_upl": 0.3,
            "futures_session_rpl": 0.1,
            "options_session_upl": 0.2,
            "options_value": 0.5,
        }
    ]
    rows = [
        _btc_deposit(10, change=1.0),
        _btc_summary(12, rpl=0.6, upl=0.5),
        _btc_summary(14, rpl=0.0, upl=0.0),
        _btc_option_trade(13, change=1.0, commission=0.01),
    ]
    shipped, indexable = await _ledger(monkeypatch, summaries, rows)
    (now_rec,) = nb.measure_member(
        summaries, {"cash_settlement": shipped}, indexable, 0, _NOW
    )
    # DERIBITWEDGE's ``equity - balance`` carries neither defect, so the shipped
    # wedge passes; the candidates still attribute against the pre-fix wedge.
    assert now_rec["gate_today"] == "pass"
    assert _ratio(now_rec["gate_candidate_rpl_only"]) > 1.0
    assert now_rec["gate_candidate_full"] == "pass"

    # Pre-fix wedge: combined session uPnL (0.3 + 0.2) + options_value 0.5.
    ledger = _pre_wedgefix(shipped, {"BTC": 1.0})
    (rec,) = nb.measure_member(
        summaries, {"cash_settlement": ledger}, indexable, 0, _NOW
    )
    assert _ratio(rec["gate_today"]) > 1.0
    assert _ratio(rec["gate_candidate_rpl_only"]) > 1.0
    assert rec["gate_candidate_full"] == "pass"
    assert rec["has_open_options_book"] is True
    assert rec["options_session_upl_nonzero"] is True
    assert rec["candidate_anchor_equals_balance"] is True


def _late_row() -> dict[str, Any]:
    return {
        "type": "settlement",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "change": 0.2,
        "index_price": 60000.0,
        "timestamp": _jul_ms(15, 20),
    }


async def test_row_booked_after_the_anchor_read_needs_the_preanchor_ledger(
    monkeypatch: Any,
) -> None:
    """H2: a row booked between the anchor read and the crawl is in the ledger but
    not in the anchor. It breaches even with the realized term stripped, and passes
    on the ledger rebuilt without it."""
    # The anchor was read BEFORE the late row was booked, so ``equity`` reconciles
    # the ledger without it exactly.
    summaries = [_summary()]
    full, indexable = await _ledger(
        monkeypatch, summaries, _perp_rows([_late_row()])
    )
    pre, _ = await _ledger(monkeypatch, summaries, _perp_rows())
    (rec,) = nb.measure_member(
        summaries,
        {"cash_settlement": full},
        indexable,
        1,
        _NOW,
        preanchor_ledger_by_basis={"cash_settlement": pre},
    )
    assert rec["rows_after_anchor"] == 1
    assert _ratio(rec["gate_candidate_rpl_only"]) > 1.0
    assert rec["gate_candidate_rpl_only_preanchor"] == "pass"


async def test_absent_venue_fields_are_field_absent_never_zero(
    monkeypatch: Any,
) -> None:
    bare = {"currency": "BTC", "equity": _EQUITY, "session_upl": _UPL}
    summaries = [bare]
    ledger, indexable = await _ledger(monkeypatch, summaries, _perp_rows())
    (rec,) = nb.measure_member(
        summaries, {"cash_settlement": ledger}, indexable, 0, _NOW
    )
    for gate in ("gate_candidate_rpl_only", "gate_candidate_full", "gate_candidate_balance"):
        assert rec[gate] == "field-absent", gate
    assert rec["candidate_anchor_equals_balance"] == "field-absent"
    assert rec["session_rpl_equals_futures_plus_options"] == "field-absent"
    assert rec["rpl_spelling_used"] == "none"
    for flag in (
        "has_futures_session_rpl_field",
        "has_session_rpl_field",
        "has_balance_field",
        "has_options_session_upl_field",
        "has_session_funding_field",
    ):
        assert rec[flag] is False, flag
    ccy = rec["currencies"][0]
    for key in (
        "resid_over_futures_session_rpl",
        "resid_over_session_rpl",
        "resid_over_options_session_upl",
        "resid_over_session_funding",
        "candidate_anchor_equals_balance",
    ):
        assert ccy[key] == "field-absent", key
    # An absent field must not make the run look quiet-and-fixed.
    assert rec["quiet"] is True  # plan: absent counts as zero for QUIET only
    assert rec["gate_candidate_rpl_only"] != "pass"


async def test_legacy_session_rpl_spelling_is_used_when_futures_one_is_missing(
    monkeypatch: Any,
) -> None:
    s = _summary()
    del s["futures_session_rpl"]
    s["session_rpl"] = _RPL
    ledger, indexable = await _ledger(monkeypatch, [s], _perp_rows())
    (rec,) = nb.measure_member([s], {"cash_settlement": ledger}, indexable, 0, _NOW)
    assert rec["rpl_spelling_used"] == "session_rpl"
    assert rec["has_futures_session_rpl_field"] is False
    assert rec["has_session_rpl_field"] is True
    assert rec["gate_candidate_rpl_only"] == "pass"


@pytest.mark.parametrize(
    ("session_rpl", "expected"),
    [(_RPL, True), (_RPL + 0.05, False)],
)
async def test_session_rpl_is_checked_against_futures_plus_options(
    monkeypatch: Any, session_rpl: float, expected: bool
) -> None:
    s = _summary(session_rpl=session_rpl, options_session_rpl=0.0)
    ledger, indexable = await _ledger(monkeypatch, [s], _perp_rows())
    (rec,) = nb.measure_member([s], {"cash_settlement": ledger}, indexable, 0, _NOW)
    assert rec["session_rpl_equals_futures_plus_options"] is expected


def test_a_basis_whose_ledger_could_not_be_built_is_recorded_not_measured() -> None:
    (rec,) = nb.measure_member(
        [_summary()],
        {"cash_settlement": "ledger-incomplete"},
        frozenset({"BTC"}),
        0,
        _NOW,
    )
    assert rec["ledger"] == "ledger-incomplete"
    for gate in ("gate_today", "gate_candidate_rpl_only", "gate_candidate_full"):
        assert rec[gate] == "not-run"
    assert rec["currencies"] == []


async def test_dust_flag_agrees_with_the_gate_so_there_is_one_definition(
    monkeypatch: Any,
) -> None:
    """The probe mirrors the gate's residual; it must not drift to a second
    definition. A non-dust residual coincides with a breach, a dust one with a pass.

    Both wedges the probe can meet are exercised, each with a breaching and a
    passing case: the pre-DERIBITWEDGE wedge (breaches on an unbooked realized
    term) and the shipped ``equity - balance`` (breaches only when the venue's cash
    ``balance`` is not what the ledger books, i.e. a real ledger gap)."""
    cases = [
        # (realized term, venue cash balance, pre-fix wedge or None, breach?)
        (_RPL, _BOOKED, {"BTC": _UPL}, True),
        (0.0, _BOOKED, {"BTC": _UPL}, False),
        (_RPL, round(_BOOKED + _RPL, 4), None, True),
        (_RPL, _BOOKED, None, False),
    ]
    for rpl, balance, pre_fix, want_breach in cases:
        s = _summary(
            futures_session_rpl=rpl,
            balance=balance,
            equity=round(balance + _UPL + rpl, 4),
        )
        ledger, indexable = await _ledger(monkeypatch, [s], _perp_rows())
        if pre_fix is not None:
            ledger = _pre_wedgefix(ledger, pre_fix)
        (rec,) = nb.measure_member(
            [s], {"cash_settlement": ledger}, indexable, 0, _NOW
        )
        assert rec["gate_today"].startswith("breach:") is want_breach
        assert rec["currencies"][0]["resid_is_dust"] is (not want_breach)


# ---------------------------------------------------------------------------
# Redaction.
# ---------------------------------------------------------------------------


def _amounts() -> list[float]:
    return [_DEPOSIT, _SETTLE, _UPL, _RPL, _BOOKED, _EQUITY]


async def test_output_carries_no_amount_and_exactly_the_declared_keys(
    monkeypatch: Any,
) -> None:
    summaries = [_summary()]
    ledger, indexable = await _ledger(monkeypatch, summaries, _perp_rows())
    (rec,) = nb.measure_member(
        summaries, {"cash_settlement": ledger}, indexable, 0, _NOW
    )
    line = nb.emit_record(rec)
    parsed = json.loads(line)
    assert set(parsed) == set(nb.RECORD_KEYS)
    assert all(set(c) == set(nb.CURRENCY_KEYS) for c in parsed["currencies"])
    for amount in _amounts():
        for text in {repr(amount), str(amount), f"{abs(amount):g}"}:
            assert text not in line, f"amount {text} reached the output"
    lowered = line.lower()
    for banned in ("secret", "token", "api_key", "account", "strategy", "uuid", "email"):
        assert banned not in lowered
    assert not re.search(r"\d{2}:\d{2}:\d{2}", line)  # no clock time finer than a day
    assert parsed["run_date"] == "2026-10-08"
    assert parsed["hours_since_last_0800_utc"] == 2.5


async def test_emitter_refuses_a_key_or_a_value_outside_the_whitelist(
    monkeypatch: Any,
) -> None:
    summaries = [_summary()]
    ledger, indexable = await _ledger(monkeypatch, summaries, _perp_rows())
    (rec,) = nb.measure_member(
        summaries, {"cash_settlement": ledger}, indexable, 0, _NOW
    )
    nb.emit_record(rec)  # control: the honest record prints

    leaked = dict(rec, equity=_EQUITY)
    with pytest.raises(ValueError):
        nb.emit_record(leaked)

    unrounded = dict(rec, hours_since_last_0800_utc=2.5000001)
    with pytest.raises(ValueError):
        nb.emit_record(unrounded)

    raw_in_currency = dict(rec, currencies=[dict(rec["currencies"][0], resid=_RPL)])
    with pytest.raises(ValueError):
        nb.emit_record(raw_in_currency)

    wrong_type = dict(rec, rows_after_anchor="1")
    with pytest.raises(ValueError):
        nb.emit_record(wrong_type)

    bool_as_count = dict(rec, rows_after_anchor=True)
    with pytest.raises(ValueError):
        nb.emit_record(bool_as_count)

    freeform = dict(rec, gate_today="breach:2.0 for the account 12345678")
    with pytest.raises(ValueError):
        nb.emit_record(freeform)

    # The refusal names the path, never the offending value.
    try:
        nb.emit_record(dict(rec, equity=_EQUITY))
    except ValueError as exc:
        assert str(_EQUITY) not in str(exc)


def test_floats_are_rounded_to_three_significant_figures() -> None:
    assert nb.sig3(0.123456) == 0.123
    assert nb.sig3(1234.5) == 1230.0
    assert nb.sig3(0.0) == 0.0
    assert nb.sig3(float("inf")) == "non-finite"
    assert nb.sig3(float("nan")) == "non-finite"


def test_hours_since_the_last_0800_settlement() -> None:
    assert nb.hours_since_last_0800_utc(_NOW) == 2.5
    early = datetime(2026, 10, 8, 7, 0, tzinfo=timezone.utc)
    assert nb.hours_since_last_0800_utc(early) == 23.0


# ---------------------------------------------------------------------------
# The recording proxy and the live seam.
# ---------------------------------------------------------------------------


class _LogStub(_NativeAnchorStub):
    """The venue: one summaries response, one transaction-log page per currency."""

    def __init__(self, rows: list[dict[str, Any]], **kw: Any) -> None:
        super().__init__(**kw)
        self._rows = rows
        self.log_calls = 0

    async def private_get_get_transaction_log(self, params: dict[str, Any]) -> Any:
        self.log_calls += 1
        rows = self._rows if params.get("currency") == "BTC" else []
        return {"result": {"logs": list(rows), "continuation": None}}

    async def private_post_buy(self, params: dict[str, Any]) -> Any:  # pragma: no cover
        raise AssertionError("a write endpoint was reached")


def _patch_enumeration(monkeypatch: Any) -> None:
    async def _scopes(_ex: Any) -> list[di.Scope]:
        return [di.Scope("main", None, True)]

    async def _auth(_ex: Any, _scope: di.Scope) -> dict[str, Any]:
        return {}

    async def _ccys(_ex: Any, _scope: di.Scope, _auth: Any) -> list[str]:
        return ["BTC"]

    monkeypatch.setattr(di, "enumerate_scopes", _scopes)
    monkeypatch.setattr(di, "resolve_scope_auth", _auth)
    monkeypatch.setattr(di, "enumerate_currencies", _ccys)
    _patch_jul_index(monkeypatch)


async def _no_sleep(_s: float) -> None:
    return None


async def test_proxy_serves_one_anchor_read_and_refuses_a_second() -> None:
    stub = _LogStub([], summaries=[_summary()], index_price={"BTC": 60000.0})
    proxy = nb.RecordingProxy(stub, clock_ms=lambda: 123)
    first = await proxy.private_get_get_account_summaries({})
    assert first["result"]["summaries"][0]["currency"] == "BTC"
    assert proxy.summaries == first["result"]["summaries"]
    with pytest.raises(RuntimeError):
        await proxy.private_get_get_account_summaries({})
    assert stub.summaries_calls == 1


async def test_proxy_exposes_reads_only() -> None:
    stub = _LogStub([], summaries=[_summary()], index_price={"BTC": 60000.0})
    proxy = nb.RecordingProxy(stub, clock_ms=lambda: 0)
    assert callable(proxy.public_get_get_index_price)
    assert callable(proxy.private_get_get_transaction_log)
    with pytest.raises(AttributeError):
        proxy.private_post_buy
    with pytest.raises(AttributeError):
        proxy.private_get_get_no_such_endpoint  # allowed prefix, absent on the venue
    with pytest.raises(AttributeError):
        proxy.close  # lifecycle is the caller's, never reachable through the proxy


async def test_proxy_counts_rows_after_the_anchor_and_keeps_none_of_them() -> None:
    early = {"type": "settlement", "currency": "BTC", "timestamp": 1_000, "change": 0.5}
    late_a = {"type": "settlement", "currency": "BTC", "timestamp": 3_000, "change": 0.7}
    late_b = {"type": "settlement", "currency": "BTC", "timestamp": 4_000, "change": 0.9}
    stub = _LogStub([early, late_a, late_b], summaries=[], index_price=None)
    proxy = nb.RecordingProxy(stub, clock_ms=lambda: 2_000)
    proxy.mark_anchor_read()
    proxy.begin_crawl(drop_after_anchor=False)
    resp = await proxy.private_get_get_transaction_log({"currency": "BTC"})
    assert len(resp["result"]["logs"]) == 3  # a counting crawl relays everything
    assert proxy.rows_after_anchor == 2
    assert not any(
        isinstance(v, list) and v and isinstance(v[0], dict)
        for k, v in vars(proxy).items()
        if k != "summaries"
    ), "the proxy retained transaction-log rows"
    proxy.begin_crawl(drop_after_anchor=True)
    dropped = await proxy.private_get_get_transaction_log({"currency": "BTC"})
    assert [r["timestamp"] for r in dropped["result"]["logs"]] == [1_000]


async def test_live_seam_measures_every_basis_and_rebuilds_pre_anchor_when_needed(
    monkeypatch: Any,
) -> None:
    _patch_enumeration(monkeypatch)
    rows = _perp_rows([_late_row()])
    stub = _LogStub(
        rows,
        summaries=[_summary()],
        index_price={"BTC": 60000.0},
    )
    recs = await nb.measure_member_live(
        stub,
        "m3",
        ("cash_settlement", "mark_to_market"),
        _NOW,
        sleep=_no_sleep,
        clock_ms=lambda: _jul_ms(15, 12),
    )
    assert stub.summaries_calls == 1  # ONE anchor read for every basis
    assert [r["basis"] for r in recs] == ["cash_settlement", "mark_to_market"]
    assert {r["member"] for r in recs} == {"m3"}
    for rec in recs:
        assert rec["rows_after_anchor"] == 1
        assert rec["ledger"] == "ok"
        nb.emit_record(rec)  # every record is emittable
    cash = recs[0]
    # On the full ledger the late row breaches even with the realized term
    # stripped; on the ledger rebuilt without it the anchor reconciles.
    assert _ratio(cash["gate_candidate_rpl_only"]) > 1.0
    assert cash["gate_candidate_rpl_only_preanchor"] == "pass"


async def test_live_seam_quiet_member_does_not_rebuild(monkeypatch: Any) -> None:
    _patch_enumeration(monkeypatch)
    stub = _LogStub(
        _perp_rows(),
        summaries=[_summary()],
        index_price={"BTC": 60000.0},
    )
    (rec,) = await nb.measure_member_live(
        stub,
        "m1",
        ("cash_settlement",),
        _NOW,
        sleep=_no_sleep,
        clock_ms=lambda: _jul_ms(15, 12),
    )
    assert rec["rows_after_anchor"] == 0
    assert rec["gate_candidate_rpl_only_preanchor"] == "not-run"
    assert stub.log_calls == 1  # no second crawl for the pre-anchor ledger


async def test_incomplete_ledger_is_recorded_as_such(monkeypatch: Any) -> None:
    _patch_enumeration(monkeypatch)

    def _incomplete(_report: Any) -> None:
        raise LedgerCompletenessError("incomplete")

    monkeypatch.setattr(nb, "assert_ledger_complete", _incomplete)
    stub = _LogStub(
        _perp_rows(), summaries=[_summary()], index_price={"BTC": 60000.0}
    )
    (rec,) = await nb.measure_member_live(
        stub,
        "m1",
        ("cash_settlement",),
        _NOW,
        sleep=_no_sleep,
        clock_ms=lambda: _jul_ms(15, 12),
    )
    assert rec["ledger"] == "ledger-incomplete"
    assert rec["gate_today"] == "not-run"


# ---------------------------------------------------------------------------
# D-06: a redacted, whitelisted detail beside ``build-error:<Type>``.
#
# Why it exists: the first live run recorded ``build-error:LedgerValuationError``
# for one member and the type alone could not say WHICH structural check raised.
# The detail names the concrete subclass and, when the message names one known
# ledger field, that field. It never carries a value: the message of a ledger
# error embeds a row id and a repr of the offending value, and this output is
# pasted into a tracked file in a public repo.
# ---------------------------------------------------------------------------

_FAKE_ID = "9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f"
_FAKE_AMOUNT = "1234.5678"
_FAKE_KEY = "not-a-real-key-Zq81XmP20vRt"  # deliberately not credential-shaped (gitleaks)

# The two real raise messages of ``OptionRowFieldMissingError`` (services/deribit_txn.py).
_COMMISSION_MSG = (
    f"option Deribit row id={_FAKE_ID!r} type='trade' "
    "INSIDE coverage has absent/null commission — the premium cash is "
    "carried by the summary channel so the fee (−commission) is the only "
    "native-pnl contribution; refusing to fabricate it"
)
_POSITION_MSG = (
    f"option Deribit row id={_FAKE_ID!r} type='trade' "
    "has an absent/null/blank/non-numeric position — the signed "
    "post-trade position is the ONLY option-book source; refusing "
    "to fabricate it (schema drift would silently mis-state MTM)"
)


async def _live_record_with_build_error(monkeypatch: Any, exc: BaseException) -> dict[str, Any]:
    _patch_enumeration(monkeypatch)

    async def _raises(*_a: Any, **_k: Any) -> Any:
        raise exc

    monkeypatch.setattr(nb, "build_deribit_native_ledger", _raises)
    stub = _LogStub(_perp_rows(), summaries=[_summary()], index_price={"BTC": 60000.0})
    (rec,) = await nb.measure_member_live(
        stub,
        "m1",
        ("smoothed_mtm",),
        _NOW,
        sleep=_no_sleep,
        clock_ms=lambda: _jul_ms(15, 12),
    )
    return rec


@pytest.mark.parametrize(
    ("message", "field"),
    [(_COMMISSION_MSG, "commission"), (_POSITION_MSG, "position")],
)
async def test_a_field_missing_error_emits_its_subclass_and_the_field(
    monkeypatch: Any, message: str, field: str
) -> None:
    from services.deribit_txn import OptionRowFieldMissingError

    rec = await _live_record_with_build_error(monkeypatch, OptionRowFieldMissingError(message))
    assert rec["ledger"] == "build-error:OptionRowFieldMissingError"
    assert rec["ledger_error_detail"] == f"OptionRowFieldMissingError:{field}"
    assert rec["gate_today"] == "not-run"
    nb.emit_record(rec)  # the detail passes the emitter's own whitelist


async def test_the_base_class_is_told_apart_from_its_subclass(monkeypatch: Any) -> None:
    from services.deribit_txn import LedgerValuationError

    rec = await _live_record_with_build_error(
        monkeypatch, LedgerValuationError("a structural check refused a row")
    )
    assert rec["ledger"] == "build-error:LedgerValuationError"
    assert rec["ledger_error_detail"] == "LedgerValuationError"


async def test_a_message_naming_two_known_fields_names_neither(monkeypatch: Any) -> None:
    from services.deribit_txn import LedgerValuationError

    rec = await _live_record_with_build_error(
        monkeypatch, LedgerValuationError("row has no commission and no position")
    )
    assert rec["ledger_error_detail"] == "LedgerValuationError"


async def test_a_message_with_an_amount_an_id_and_a_key_never_reaches_the_output(
    monkeypatch: Any,
) -> None:
    from services.deribit_txn import LedgerValuationError

    hostile = (
        f"Deribit row id={_FAKE_ID!r} type='trade' has a non-numeric commission "
        f"{_FAKE_AMOUNT!r} for account 12345678 using {_FAKE_KEY} at 2026-10-08T10:30:15Z"
    )
    rec = await _live_record_with_build_error(monkeypatch, LedgerValuationError(hostile))
    line = nb.emit_record(rec)
    for leak in (_FAKE_ID, _FAKE_AMOUNT, _FAKE_KEY, "12345678", "10:30:15", "account", "non-numeric"):
        assert leak not in line, f"{leak!r} reached the output"
    assert rec["ledger_error_detail"] == "LedgerValuationError:commission"
    assert not re.search(r"\d", rec["ledger_error_detail"])


async def test_a_subclass_off_the_allow_list_is_emitted_as_other(monkeypatch: Any) -> None:
    from services.deribit_txn import LedgerValuationError

    class AcmeAccount12345Error(LedgerValuationError):
        pass

    rec = await _live_record_with_build_error(
        monkeypatch, AcmeAccount12345Error(f"commission {_FAKE_AMOUNT}")
    )
    assert rec["ledger_error_detail"] == "other"
    assert "other" in nb.emit_record(rec)


@pytest.mark.parametrize(
    "bad",
    [
        "LedgerValuationError:commission=1234.5678",
        "LedgerValuationError:not_a_ledger_field",
        "NotAKnownClass",
        "OptionRowFieldMissingError:position:commission",
        "",
        1234.5,
        True,
    ],
)
def test_the_emitter_refuses_a_detail_outside_the_allow_lists(bad: Any) -> None:
    (rec,) = nb.measure_member(
        [_summary()], {"cash_settlement": "build-error:LedgerValuationError"},
        frozenset({"BTC"}), 0, _NOW,
    )
    nb.emit_record(rec)  # control: the honest record prints
    with pytest.raises(ValueError) as exc:
        nb.emit_record(dict(rec, ledger_error_detail=bad))
    assert "ledger_error_detail" in str(exc.value)
    if isinstance(bad, str) and bad:
        assert bad not in str(exc.value)  # the refusal names the path, never the value


async def test_a_ledger_that_built_or_was_incomplete_carries_no_detail(monkeypatch: Any) -> None:
    (done,) = nb.measure_member(
        [_summary()], {"cash_settlement": "ledger-incomplete"}, frozenset({"BTC"}), 0, _NOW
    )
    assert done["ledger_error_detail"] is None
    summaries = [_summary()]
    ledger, indexable = await _ledger(monkeypatch, summaries, _perp_rows())
    (ok,) = nb.measure_member(summaries, {"cash_settlement": ledger}, indexable, 0, _NOW)
    assert ok["ledger"] == "ok"
    assert ok["ledger_error_detail"] is None


# ---------------------------------------------------------------------------
# Refusals and source-level safety.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("row", "refused"),
    [
        ({"exchange": "deribit", "is_active": True}, False),
        ({"exchange": "binance", "is_active": True}, True),
        ({"exchange": "deribit", "is_active": False}, True),
        ({"exchange": "deribit"}, True),
    ],
)
def test_a_member_that_is_not_an_active_deribit_key_is_refused(
    row: dict[str, Any], refused: bool
) -> None:
    assert (nb.refusal_reason(row) is not None) is refused


def test_the_probe_cannot_write_and_never_calls_the_breaker_preflight() -> None:
    assert "_allocator_key_preflight(" not in _PROBE_SRC
    for write in (".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "enqueue"):
        assert write not in _PROBE_SRC, write


def test_the_probe_imports_the_gate_dust_constant_and_restates_no_threshold() -> None:
    assert "INCEPTION_NATIVE_DUST_REL" in _PROBE_SRC
    assert not re.search(
        r"(?i)\b[A-Za-z_]*(dust|tol)[A-Za-z_]*\s*(:\s*\w+\s*)?=\s*[0-9]", _PROBE_SRC
    )


def test_the_exit_codes_are_the_documented_ones() -> None:
    assert (nb.EXIT_OK, nb.EXIT_FAILED, nb.EXIT_REFUSED) == (0, 1, 2)


def test_main_refuses_without_a_strategy_id(capsys: Any) -> None:
    with pytest.raises(SystemExit) as exc:
        nb.main([])
    assert exc.value.code != 0
    assert asyncio.iscoroutinefunction(nb.run)
