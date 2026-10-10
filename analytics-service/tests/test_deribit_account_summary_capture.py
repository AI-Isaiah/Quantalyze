"""Phase 167.1.2.2.1 (DERIBITWEDGE) PR-1 — the one summaries read is STORED, not just used.

THE GAP. A Deribit key-mode derive reads ``get_account_summaries`` once and rolls the whole
history back from it, but kept nothing of that read. Two derives a day apart over the same
ledger rows could differ and nobody could say whether the wedge or the ledger moved. This
plan stores the read (``account_summary``), a per-currency verdict on the documented identity
``equity = balance + futures_session_upl + futures_session_rpl + options_value``, and a digest
of the crawled transaction log (``ledger_digest``) in the key's ``key_inputs`` payload.

NOTHING A DERIVE COMPUTES CHANGES HERE. Every assertion below is about what is stored.

THE ORACLES ARE RESTATED, NOT IMPORTED. The precision rule (8 decimal places give a tolerance
of 4e-8) and the 64-hex digest shape are written by hand in this file.

Root-cause note: see the debug note named derivecron-compose-divergence.
"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from services.allocator_equity_derive import (
    account_summary_payload,
    ledger_digest_payload,
    read_account_summary,
    read_ledger_digest,
)
from services.deribit_ingest import (
    CompletenessReport,
    DeribitNativeAccountState,
    fetch_deribit_native_account_state,
)
from services.nav_twr import NavReconstructionError
from tests.test_deribit_ingest import _NativeAnchorStub

# 8-decimal fixtures as Deribit reports them. equity is the EXACT decimal sum of its parts.
_BTC_SUMMARY: dict[str, Any] = {
    "currency": "BTC",
    "equity": 3.12345678,
    "balance": 2.12345678,
    "futures_session_upl": 0.50000001,
    "futures_session_rpl": 0.0,
    "options_value": 0.49999999,
    "options_session_upl": 0.1,
    "session_upl": 0.6,
    "margin_model": "segregated_sm",
    "cross_collateral_enabled": False,
}
# Fields that identify a person or an account. None may ever reach a stored snapshot.
_IDENTIFYING = {
    "email": "someone@example.com",
    "id": 424242,
    "username": "someone",
    "system_name": "someone-main",
    "type": "main",
}


def _state_from(summaries: list[dict[str, Any]], **kw: Any) -> Any:
    ex = _NativeAnchorStub(summaries=summaries, index_price={"BTC": 60000.0})
    return fetch_deribit_native_account_state(ex, **kw)


# ── the state keeps what the single read returned ────────────────────────────────


@pytest.mark.asyncio
async def test_balance_is_read_present_only() -> None:
    state = await _state_from([{**_BTC_SUMMARY, "balance": 2.0}])
    assert state.native_balance == {"BTC": 2.0}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "balance",
    [
        pytest.param("ABSENT", id="absent"),
        pytest.param(None, id="null"),
        pytest.param(True, id="bool"),
        pytest.param(float("nan"), id="nan"),
        pytest.param(float("inf"), id="inf"),
        pytest.param("2.0", id="string"),
    ],
)
async def test_an_unreadable_balance_is_absent_never_zero(balance: Any) -> None:
    """Absent is not zero. A coalesced 0.0 would read as 'the cash balance is exactly nil'
    and silently pick the wrong branch of any later cash-anchored wedge."""
    summ = {k: v for k, v in _BTC_SUMMARY.items() if k != "balance"}
    if balance != "ABSENT":
        summ["balance"] = balance
    state = await _state_from([summ])
    assert "BTC" not in state.native_balance
    assert "balance" not in state.summary_snapshot["BTC"]


@pytest.mark.asyncio
async def test_snapshot_keeps_whitelisted_keys_only() -> None:
    """The identifying fields never reach the stored snapshot (T-167.1.2.2.1-01)."""
    state = await _state_from([{**_BTC_SUMMARY, **_IDENTIFYING, "a_future_field": 7.0}])
    snap = state.summary_snapshot["BTC"]
    for key in _IDENTIFYING:
        assert key not in snap, key
    assert "a_future_field" not in snap
    assert snap["equity"] == 3.12345678
    assert snap["margin_model"] == "segregated_sm"
    assert snap["cross_collateral_enabled"] is False


@pytest.mark.asyncio
async def test_snapshot_refuses_wrongly_typed_whitelisted_fields() -> None:
    state = await _state_from(
        [
            {
                **_BTC_SUMMARY,
                "margin_model": 5,
                "cross_collateral_enabled": "yes",
                "total_pl": float("nan"),
                "margin_balance": True,
            }
        ]
    )
    snap = state.summary_snapshot["BTC"]
    for key in ("margin_model", "cross_collateral_enabled", "total_pl", "margin_balance"):
        assert key not in snap, key


@pytest.mark.asyncio
async def test_state_carries_the_index_and_the_read_time() -> None:
    from datetime import datetime

    state = await _state_from([_BTC_SUMMARY])
    assert state.index_usd_snapshot == {"BTC": 60000.0}
    parsed = datetime.fromisoformat(state.read_at_iso)
    assert parsed.tzinfo is not None and parsed.utcoffset().total_seconds() == 0


@pytest.mark.asyncio
async def test_a_failed_read_leaves_the_capture_fields_at_their_defaults() -> None:
    ex = _NativeAnchorStub(summaries=None, summaries_exc=RuntimeError("down"))
    state = await fetch_deribit_native_account_state(ex)
    assert state.native_balance == {} and state.summary_snapshot == {}
    assert state.index_usd_snapshot == {} and state.read_at_iso is None


# ── the identity verdict ─────────────────────────────────────────────────────────


def _payload_for(summary: dict[str, Any], *, index: dict[str, float] | None = None) -> dict[str, Any]:
    snap = {
        k: v
        for k, v in summary.items()
        if k not in ("currency", *_IDENTIFYING)
    }
    state = DeribitNativeAccountState(
        native_equity={}, native_upnl={}, collapsed_equity_usd=None,
        collapsed_upnl_usd=0.0, balance_error=False, upnl_unreadable=False,
        native_options_value={},
        summary_snapshot={str(summary["currency"]): snap},
        index_usd_snapshot=index or {},
        read_at_iso="2026-10-09T05:30:00+00:00",
    )
    return account_summary_payload(state)["account_summary"]


def test_identity_holds_on_the_exact_decimal_sum() -> None:
    ident = _payload_for(_BTC_SUMMARY)["identity"]["BTC"]
    assert ident["identity_ok"] is True
    assert ident["identity_resid_ratio"] == 0.0


def test_identity_breaks_by_the_residual_over_the_published_precision_tolerance() -> None:
    """MD-02: Deribit reports each coin field to 8 decimal places and the identity has five
    rounded terms, so rounding alone can show 5 * 0.5e-8 = 2.5e-8 (restated, not imported).
    A residual of 1e-6 is 40 tolerances."""
    off = {**_BTC_SUMMARY, "equity": 3.12345778}
    ident = _payload_for(off)["identity"]["BTC"]
    assert ident["identity_ok"] is False
    assert ident["identity_resid_ratio"] == pytest.approx(1e-6 / 2.5e-8, rel=1e-6)


def test_identity_tolerates_rounding_of_the_published_precision_and_no_more() -> None:
    """A residual of 2e-8 is inside five half-units of the 8th place (2.5e-8); 3e-8 is not."""
    inside = _payload_for({**_BTC_SUMMARY, "equity": 3.1234568})["identity"]["BTC"]
    assert inside["identity_ok"] is True
    assert inside["identity_resid_ratio"] == pytest.approx(2e-8 / 2.5e-8, rel=1e-6)
    outside = _payload_for({**_BTC_SUMMARY, "equity": 3.12345681})["identity"]["BTC"]
    assert outside["identity_ok"] is False
    assert outside["identity_resid_ratio"] == pytest.approx(3e-8 / 2.5e-8, rel=1e-6)


def test_identity_mixed_precision_reads_true() -> None:
    """MD-02 false break. options_value is a computed mark shown to 10 places, equity is
    Deribit's rounding to 8: 1.0 + 0.1234567891 = 1.1234567891, equity 1.12345679, so the
    residual is 9e-10, far inside 2.5e-8. The precision of the finest field must not tighten
    the tolerance for the others."""
    summ = {"currency": "BTC", "equity": 1.12345679, "balance": 1.0,
            "options_value": 0.1234567891}
    ident = _payload_for(summ)["identity"]["BTC"]
    assert ident["identity_ok"] is True
    assert ident["identity_resid_ratio"] == pytest.approx(9e-10 / 2.5e-8, rel=1e-6)


def test_identity_round_values_do_not_hide_a_real_gap() -> None:
    """MD-02 false pass. Every value happens to be round, so no precision can be inferred
    from them. equity 100.0 against balance 99.7 is a 0.3 coin gap, which is 3e6 times the
    tolerance max(2.5e-8, 1e-9 * 100) = 1e-7."""
    ident = _payload_for({"currency": "BTC", "equity": 100.0, "balance": 99.7})["identity"]["BTC"]
    assert ident["identity_ok"] is False
    assert ident["identity_resid_ratio"] == pytest.approx(0.3 / 1e-7, rel=1e-6)


def test_identity_relative_tolerance_takes_over_for_a_large_equity() -> None:
    """Above |equity| = 25 coins the relative term 1e-9 * |equity| exceeds the 2.5e-8 floor.
    equity 1000.0000005 against balance 1000.0: residual 5e-7 against 1e-6."""
    ident = _payload_for(
        {"currency": "BTC", "equity": 1000.0000005, "balance": 1000.0}
    )["identity"]["BTC"]
    assert ident["identity_ok"] is True
    assert ident["identity_resid_ratio"] == pytest.approx(0.5, rel=1e-6)


def test_identity_stores_the_signed_residual_and_the_places_for_offline_rejudging() -> None:
    """Plan 05 can re-judge from the stored snapshot without trusting this tolerance."""
    below = _payload_for({"currency": "BTC", "equity": 1.0, "balance": 1.3})["identity"]["BTC"]
    assert below["identity_resid_native"] == pytest.approx(-0.3, abs=1e-12)
    assert below["identity_places"] == 8
    above = _payload_for({"currency": "BTC", "equity": 1.3, "balance": 1.0})["identity"]["BTC"]
    assert above["identity_resid_native"] == pytest.approx(0.3, abs=1e-12)
    # Not computable (no balance): there is no residual to store, but the places still are.
    none = _payload_for({"currency": "BTC", "equity": 1.0})["identity"]["BTC"]
    assert none["identity_resid_native"] is None
    assert none["identity_places"] == 8


def test_identity_is_not_computable_without_a_balance_and_never_true() -> None:
    summ = {k: v for k, v in _BTC_SUMMARY.items() if k != "balance"}
    ident = _payload_for(summ)["identity"]["BTC"]
    assert ident["identity_ok"] is None
    assert ident["identity_resid_ratio"] is None


def test_identity_falls_back_to_session_upl_and_counts_missing_parts_as_zero() -> None:
    summ = {
        "currency": "BTC", "equity": 1.5, "balance": 1.0,
        "session_upl": 0.5, "margin_model": "segregated_sm",
    }
    ident = _payload_for(summ)["identity"]["BTC"]
    assert ident["identity_ok"] is True
    assert ident["has_open_options"] is False
    assert ident["options_session_upl_nonzero"] is False
    # MD-02: the fallback can now FAIL. A wrong fallback (e.g. ignoring session_upl) would give
    # a residual of 0.5 here, and equity 1.8 leaves 0.3 unexplained under the right one.
    off = _payload_for({**summ, "equity": 1.8})["identity"]["BTC"]
    assert off["identity_ok"] is False
    assert off["identity_resid_native"] == pytest.approx(0.3, abs=1e-12)


def test_identity_flags_the_open_option_book() -> None:
    ident = _payload_for(_BTC_SUMMARY)["identity"]["BTC"]
    assert ident["has_open_options"] is True
    assert ident["options_session_upl_nonzero"] is True


def test_payload_shape_is_sorted_numeric_and_carries_the_margin_model() -> None:
    state = DeribitNativeAccountState(
        native_equity={}, native_upnl={}, collapsed_equity_usd=None,
        collapsed_upnl_usd=0.0, balance_error=False, upnl_unreadable=False,
        native_options_value={},
        summary_snapshot={
            "ETH": {"equity": 1.0, "balance": 1.0},
            "BTC": {k: v for k, v in _BTC_SUMMARY.items() if k != "currency"},
        },
        index_usd_snapshot={"ETH": 2500.0, "BTC": 60000.0},
        read_at_iso="2026-10-09T05:30:00+00:00",
    )
    out = account_summary_payload(state)["account_summary"]
    assert out["read_at"] == "2026-10-09T05:30:00+00:00"
    assert [s["currency"] for s in out["summaries"]] == ["BTC", "ETH"]
    assert out["summaries"][0]["margin_model"] == "segregated_sm"
    assert out["summaries"][0]["cross_collateral_enabled"] is False
    assert out["index_usd"] == {"BTC": 60000.0, "ETH": 2500.0}
    assert set(out["identity"]) == {"BTC", "ETH"}
    json.dumps(out, allow_nan=False)  # JSONB-safe


def test_the_writer_refuses_a_non_finite_value() -> None:
    state = DeribitNativeAccountState(
        native_equity={}, native_upnl={}, collapsed_equity_usd=None,
        collapsed_upnl_usd=0.0, balance_error=False, upnl_unreadable=False,
        native_options_value={},
        summary_snapshot={"BTC": {"equity": float("nan"), "balance": 1.0}},
    )
    with pytest.raises(NavReconstructionError):
        account_summary_payload(state)


# ── the strict reader ────────────────────────────────────────────────────────────


def test_the_reader_accepts_a_row_written_before_the_residual_fields_and_round_trips_new_ones() -> None:
    stored = json.loads(json.dumps(_payload_for(_BTC_SUMMARY, index={"BTC": 60000.0})))
    got = read_account_summary({"account_summary": stored})
    assert got is not None
    assert got["identity"]["BTC"]["identity_places"] == 8
    assert isinstance(got["identity"]["BTC"]["identity_resid_native"], float)
    for key in ("identity_resid_native", "identity_places"):
        del stored["identity"]["BTC"][key]
    old_row = read_account_summary({"account_summary": stored})
    assert old_row is not None and "identity_places" not in old_row["identity"]["BTC"]


@pytest.mark.parametrize(
    "key, bad, exc",
    [
        ("identity_resid_native", True, TypeError),
        ("identity_resid_native", "0.1", TypeError),
        ("identity_resid_native", float("nan"), ValueError),
        ("identity_places", True, TypeError),
        ("identity_places", 8.0, TypeError),
        ("identity_places", "8", TypeError),
    ],
)
def test_the_reader_refuses_a_malformed_residual_field(key: str, bad: Any, exc: type) -> None:
    stored = json.loads(json.dumps(_payload_for(_BTC_SUMMARY, index={"BTC": 60000.0})))
    stored["identity"]["BTC"][key] = bad
    with pytest.raises(exc):
        read_account_summary({"account_summary": stored})


def test_an_old_row_reads_as_none() -> None:
    assert read_account_summary({}) is None
    assert read_account_summary({"account_summary": None}) is None
    assert read_account_summary({"account_summary_error": "ValueError"}) is None


def test_the_reader_round_trips_the_writer() -> None:
    stored = _payload_for(_BTC_SUMMARY, index={"BTC": 60000.0})
    got = read_account_summary({"account_summary": json.loads(json.dumps(stored))})
    assert got is not None
    assert got["summaries"][0]["balance"] == 2.12345678
    assert got["identity"]["BTC"]["identity_ok"] is True


@pytest.mark.parametrize(
    "mutate, exc",
    [
        pytest.param(lambda a: a["summaries"][0].__setitem__("balance", True), TypeError, id="bool-number"),
        pytest.param(lambda a: a["summaries"][0].__setitem__("balance", float("nan")), ValueError, id="nan"),
        pytest.param(lambda a: a["summaries"][0].__setitem__("balance", "2.0"), TypeError, id="string-number"),
        pytest.param(lambda a: a["summaries"][0].__setitem__("email", "x@y.z"), TypeError, id="string-field"),
        pytest.param(lambda a: a["summaries"].append(dict(a["summaries"][0])), ValueError, id="duplicate-currency"),
        pytest.param(lambda a: a["index_usd"].__setitem__("BTC", float("inf")), ValueError, id="inf-index"),
        pytest.param(lambda a: a["identity"]["BTC"].__setitem__("identity_ok", 1), TypeError, id="int-verdict"),
        pytest.param(lambda a: a.__setitem__("summaries", {"BTC": 1}), TypeError, id="summaries-not-list"),
    ],
)
def test_a_malformed_stored_snapshot_raises(mutate: Any, exc: type[Exception]) -> None:
    stored = json.loads(json.dumps(_payload_for(_BTC_SUMMARY, index={"BTC": 60000.0})))
    mutate(stored)
    with pytest.raises(exc):
        read_account_summary({"account_summary": stored})


# ── through the whole mocked key-mode derive ─────────────────────────────────────


def _key_inputs_payload(capture: dict, key_id: str) -> dict:
    from tests.test_allocator_equity_dropped_day_pnl import _key_inputs_payload as _impl

    return _impl(capture, key_id)


async def _run_deribit_key_mode_derive(
    state: Any, *, report: Any = None, ledger: Any = None, trace: dict | None = None
) -> tuple[dict, AsyncMock]:
    """``ledger`` replaces the marks-free stub ledger the build returns; ``trace`` (when given)
    is filled with the ``combine`` mock so a test can see what the worker handed it."""
    import pandas as pd

    from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
    from tests.test_mtm_single_key import (
        _apply,
        _base_patches,
        _ctx,
        _ledger_meta,
        _recording_ledger,
        _report,
    )

    idx = pd.DatetimeIndex(["2024-05-01", "2024-05-02", "2024-05-03"])
    returns = pd.Series([0.01, -0.02, 0.03], index=idx)
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    ledger_mock, _calls = _recording_ledger([report or _report(has_option_activity=False)])
    if ledger is not None:
        ledger_mock = AsyncMock(
            return_value=(ledger, report or _report(has_option_activity=False))
        )
    combine = MagicMock(return_value=(returns, _ledger_meta()))
    if trace is not None:
        trace["combine"] = combine
    state_spy = AsyncMock(return_value=state)
    with _apply(
        _base_patches(
            ctx, key_mode=True, ledger_mock=ledger_mock, combine_mock=combine,
            state_spy=state_spy,
        )
    ):
        result = await run_derive_broker_dailies_job(
            {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-drb"}
        )
    assert result.outcome == DispatchOutcome.DONE
    return _key_inputs_payload(capture, "key-drb"), state_spy


@pytest.mark.asyncio
async def test_a_key_mode_derive_stores_the_one_summaries_read() -> None:
    state = await _state_from([{**_BTC_SUMMARY, **_IDENTIFYING}])
    payload, state_spy = await _run_deribit_key_mode_derive(state)

    stored = payload["account_summary"]
    assert stored["read_at"] == state.read_at_iso
    assert [s["currency"] for s in stored["summaries"]] == ["BTC"]
    assert stored["index_usd"] == {"BTC": 60000.0}
    assert stored["identity"]["BTC"]["identity_ok"] is True
    assert stored["identity"]["BTC"]["identity_resid_ratio"] == 0.0
    # No identifying field anywhere in what the job wrote.
    blob = json.dumps(payload)
    for value in _IDENTIFYING.values():
        assert str(value) not in blob
    # The strict reader accepts exactly what the job wrote.
    assert read_account_summary(payload) is not None
    # Stored, not re-read: the derive still takes exactly ONE summaries read.
    assert state_spy.call_count == 1


@pytest.mark.asyncio
async def test_a_capture_failure_never_fails_the_derive_and_is_never_silent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A poison value reaching the writer: the derive completes and the payload NAMES the
    failure with the exception class only (W9)."""
    poison = DeribitNativeAccountState(
        native_equity={"BTC": 1.0}, native_upnl={}, collapsed_equity_usd=100_000.0,
        collapsed_upnl_usd=0.0, balance_error=False, upnl_unreadable=False,
        native_options_value={},
        summary_snapshot={"BTC": {"equity": float("nan"), "balance": 1.0}},
    )
    with caplog.at_level("WARNING"):
        payload, _spy = await _run_deribit_key_mode_derive(poison)
    assert "account_summary" not in payload
    assert payload["account_summary_error"] == "NavReconstructionError"
    warnings = [r for r in caplog.records if "account_summary" in r.getMessage()]
    assert len(warnings) == 1
    assert "nan" not in warnings[0].getMessage().lower()


@pytest.mark.asyncio
async def test_an_account_with_no_snapshot_still_stores_an_empty_but_valid_one() -> None:
    """A read whose summaries carried nothing whitelisted: still a stored, readable record."""
    bare = DeribitNativeAccountState(
        native_equity={"BTC": 1.0}, native_upnl={}, collapsed_equity_usd=100_000.0,
        collapsed_upnl_usd=0.0, balance_error=False, upnl_unreadable=False,
        native_options_value={},
    )
    payload, _spy = await _run_deribit_key_mode_derive(bare)
    got = read_account_summary(payload)
    assert got is not None and got["summaries"] == []


# ── the ledger digest ────────────────────────────────────────────────────────────


def _expected_digest(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Restated by hand: sort (timestamp, str(id)), canonical JSON, newline-join, sha256."""
    ordered = sorted(rows, key=lambda r: (int(r["timestamp"]), str(r.get("id"))))
    body = "\n".join(
        json.dumps(r, sort_keys=True, separators=(",", ":"), default=str) for r in ordered
    )
    return {
        "row_count": len(rows),
        "max_timestamp_ms": max(int(r["timestamp"]) for r in rows),
        "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
    }


_ROWS = [
    {"id": 3, "timestamp": 1_700_000_300_000, "type": "settlement", "change": 0.5},
    {"id": 1, "timestamp": 1_700_000_100_000, "type": "deposit", "change": 2.0},
    {"id": 2, "timestamp": 1_700_000_200_000, "type": "trade", "change": -0.1},
]


def test_the_digest_matches_the_hand_restated_canonical_form() -> None:
    from services.deribit_ingest import deribit_ledger_digest

    assert deribit_ledger_digest(_ROWS) == _expected_digest(_ROWS)


def test_the_digest_is_stable_under_page_order() -> None:
    from services.deribit_ingest import deribit_ledger_digest

    assert deribit_ledger_digest(_ROWS) == deribit_ledger_digest(list(reversed(_ROWS)))


def test_an_added_row_moves_the_count_and_the_hash() -> None:
    from services.deribit_ingest import deribit_ledger_digest

    base = deribit_ledger_digest(_ROWS)
    more = deribit_ledger_digest(
        [*_ROWS, {"id": 4, "timestamp": 1_700_000_400_000, "type": "trade", "change": 0.01}]
    )
    assert more["row_count"] == base["row_count"] + 1
    assert more["sha256"] != base["sha256"]
    assert more["max_timestamp_ms"] == 1_700_000_400_000


def test_the_digest_holds_no_raw_row_value() -> None:
    from services.deribit_ingest import deribit_ledger_digest

    d = deribit_ledger_digest(_ROWS)
    assert set(d) == {"row_count", "max_timestamp_ms", "sha256"}
    assert isinstance(d["row_count"], int) and isinstance(d["max_timestamp_ms"], int)
    assert len(d["sha256"]) == 64 and set(d["sha256"]) <= set("0123456789abcdef")
    blob = json.dumps(d)
    for row in _ROWS:
        assert str(row["change"]) not in blob


def test_no_rows_digest_has_no_max_timestamp() -> None:
    from services.deribit_ingest import deribit_ledger_digest

    d = deribit_ledger_digest([])
    assert d["row_count"] == 0 and d["max_timestamp_ms"] is None
    assert d["sha256"] == hashlib.sha256(b"").hexdigest()


def test_missing_and_mixed_type_ids_digest_without_raising() -> None:
    from services.deribit_ingest import deribit_ledger_digest

    rows = [
        {"timestamp": 1_700_000_000_000, "type": "a"},
        {"id": "x", "timestamp": 1_700_000_000_000, "type": "b"},
        {"id": 7, "timestamp": 1_700_000_000_000, "type": "c"},
        {"id": None, "timestamp": 1_700_000_000_000, "type": "d"},
    ]
    assert deribit_ledger_digest(rows) == deribit_ledger_digest(list(reversed(rows)))


def test_equal_timestamp_and_id_rows_still_digest_order_independently() -> None:
    """Two rows can share (timestamp, id) across subaccount scopes. The tie is broken by the
    row content, so page order still cannot move the hash."""
    from services.deribit_ingest import deribit_ledger_digest

    rows = [
        {"id": 1, "timestamp": 1_700_000_000_000, "scope": "a", "change": 1.0},
        {"id": 1, "timestamp": 1_700_000_000_000, "scope": "b", "change": 2.0},
    ]
    assert deribit_ledger_digest(rows) == deribit_ledger_digest(list(reversed(rows)))


def test_the_digest_payload_round_trips_and_the_reader_is_strict() -> None:
    from services.deribit_ingest import deribit_ledger_digest

    digest = deribit_ledger_digest(_ROWS)
    stored = json.loads(json.dumps(ledger_digest_payload(digest)))
    assert read_ledger_digest(stored) == digest
    assert read_ledger_digest({}) is None
    assert read_ledger_digest({"ledger_digest": None}) is None
    assert read_ledger_digest({"ledger_digest_error": "TypeError"}) is None
    for bad in (
        {**digest, "row_count": "3"},
        {**digest, "row_count": True},
        {**digest, "row_count": -1},
        {**digest, "max_timestamp_ms": 1.5},
        {**digest, "sha256": "ZZ" * 32},
        {**digest, "sha256": digest["sha256"].upper()},
        {**digest, "sha256": digest["sha256"][:-1]},
        {**digest, "extra": 1},
    ):
        with pytest.raises((TypeError, ValueError)):
            read_ledger_digest({"ledger_digest": bad})


def test_the_digest_payload_writer_refuses_a_malformed_digest() -> None:
    with pytest.raises((TypeError, ValueError)):
        ledger_digest_payload({"row_count": 1, "max_timestamp_ms": None, "sha256": "short"})


@pytest.mark.asyncio
async def test_a_key_mode_derive_stores_the_digest_of_the_ledger_it_crawled() -> None:
    from services.deribit_ingest import deribit_ledger_digest
    from tests.test_mtm_single_key import _report

    report = _report(has_option_activity=False)
    report.ledger_digest = deribit_ledger_digest(_ROWS)
    bare = DeribitNativeAccountState(
        native_equity={"BTC": 1.0}, native_upnl={}, collapsed_equity_usd=100_000.0,
        collapsed_upnl_usd=0.0, balance_error=False, upnl_unreadable=False,
        native_options_value={},
    )
    payload, _spy = await _run_deribit_key_mode_derive(bare, report=report)
    assert read_ledger_digest(payload) == report.ledger_digest
    assert "ledger_digest_error" not in payload


@pytest.mark.asyncio
async def test_a_digest_that_could_not_be_computed_is_named_and_the_derive_completes(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from tests.test_mtm_single_key import _report

    report = _report(has_option_activity=False)
    report.ledger_digest_error = "TypeError"
    bare = DeribitNativeAccountState(
        native_equity={"BTC": 1.0}, native_upnl={}, collapsed_equity_usd=100_000.0,
        collapsed_upnl_usd=0.0, balance_error=False, upnl_unreadable=False,
        native_options_value={},
    )
    with caplog.at_level("WARNING"):
        payload, _spy = await _run_deribit_key_mode_derive(bare, report=report)
    assert "ledger_digest" not in payload
    assert payload["ledger_digest_error"] == "TypeError"
    assert len([r for r in caplog.records if "ledger_digest" in r.getMessage()]) == 1


@pytest.mark.asyncio
async def test_a_poison_digest_does_not_fail_the_derive() -> None:
    from tests.test_mtm_single_key import _report

    report = _report(has_option_activity=False)
    report.ledger_digest = {"row_count": 1, "max_timestamp_ms": None, "sha256": "not-hex"}
    bare = DeribitNativeAccountState(
        native_equity={"BTC": 1.0}, native_upnl={}, collapsed_equity_usd=100_000.0,
        collapsed_upnl_usd=0.0, balance_error=False, upnl_unreadable=False,
        native_options_value={},
    )
    payload, _spy = await _run_deribit_key_mode_derive(bare, report=report)
    assert "ledger_digest" not in payload
    assert payload["ledger_digest_error"] in ("ValueError", "TypeError")


@pytest.mark.asyncio
async def test_a_ccxt_key_payload_carries_neither_new_field() -> None:
    from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
    from tests.test_derive_broker_dailies_dualmode import (
        _build_ctx,
        _patches,
        _two_day_returns,
    )

    ctx, capture = _build_ctx(
        key_row={"id": "key-b", "exchange": "binance", "user_id": "alloc-b"}, strategy_row=None
    )
    patches = _patches(ctx, key_mode=True, returns=_two_day_returns())
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await run_derive_broker_dailies_job(
            {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-b"}
        )
    assert result.outcome == DispatchOutcome.DONE
    payload = _key_inputs_payload(capture, "key-b")
    assert "account_summary" not in payload and "ledger_digest" not in payload
    assert "account_summary_error" not in payload and "ledger_digest_error" not in payload


# ── the digest is wired into the real ledger build ───────────────────────────────


@pytest.mark.asyncio
async def test_the_real_build_digests_the_crawled_rows_and_is_page_order_stable(
    monkeypatch: Any,
) -> None:
    import services.deribit_ingest as di
    from tests.test_deribit_ingest import (
        _open_book_paginate,
        _patch_jul_index,
        _patch_pipeline,
    )

    async def _build(reverse: bool) -> Any:
        base = _open_book_paginate()

        async def _paginate(*a: Any, **k: Any) -> list[Any]:
            rows = await base(*a, **k)
            return list(reversed(rows)) if reverse else rows

        _patch_pipeline(
            monkeypatch, scopes=[di.Scope("main", None, True)],
            currencies={"main": ["BTC"]}, paginate=_paginate,
        )
        _patch_jul_index(monkeypatch)
        ex = _NativeAnchorStub(
            summaries=[{"currency": "BTC", "equity": 3.0, "session_upl": 0.5,
                        "options_value": 0.5}],
            index_price={"BTC": 60000.0},
        )
        _ledger, report = await di.build_deribit_native_ledger(ex)
        return report

    forward = await _build(False)
    backward = await _build(True)
    assert forward.ledger_digest is not None
    assert forward.ledger_digest["row_count"] == 4
    assert forward.ledger_digest == backward.ledger_digest
    assert forward.ledger_digest_error is None


@pytest.mark.asyncio
async def test_a_digest_failure_inside_the_build_leaves_the_build_complete(
    monkeypatch: Any,
) -> None:
    import services.deribit_ingest as di
    from tests.test_deribit_ingest import (
        _open_book_paginate,
        _patch_jul_index,
        _patch_pipeline,
    )

    _patch_pipeline(
        monkeypatch, scopes=[di.Scope("main", None, True)],
        currencies={"main": ["BTC"]}, paginate=_open_book_paginate(),
    )
    _patch_jul_index(monkeypatch)

    def _boom(_rows: Any) -> Any:
        raise TypeError("canonicalisation failed")

    monkeypatch.setattr(di, "deribit_ledger_digest", _boom)
    ex = _NativeAnchorStub(
        summaries=[{"currency": "BTC", "equity": 3.0, "session_upl": 0.5,
                    "options_value": 0.5}],
        index_price={"BTC": 60000.0},
    )
    ledger, report = await di.build_deribit_native_ledger(ex)
    assert ledger is not None
    assert report.ledger_digest is None
    assert report.ledger_digest_error == "TypeError"


def test_report_defaults_leave_every_existing_constructor_valid() -> None:
    r = CompletenessReport(total_return_rows=2)
    assert r.ledger_digest is None and r.ledger_digest_error is None
    assert math.isfinite(r.total_return_rows)


# ── MD-01: a REFUSED derive still stores what it read (D-03) ─────────────────────
#
# The PR-1 review's finding: all three captures were assigned after ``combine_native_ledger``
# returned, so a derive the section 5 gate (or any other structural refusal) turned away stored
# nothing, although its one summaries read and its full crawl had already happened. Those are
# exactly the derives a diagnosis needs. A refusal now writes a ``key_capture:<api_key_id>``
# row, and never touches ``key_inputs:<api_key_id>``, which the compose reads for flows and the
# anchor and which must stay the last good derive's.


def _breaching_ledger() -> Any:
    """The 6.48-BTC-throughput shape with a MATERIAL 0.5 BTC residual (above the dust
    allowance), so section 5 refuses: Σpnl 6.479214, withdrawn 6.479202, terminal 0.5."""
    from services.external_flows import ExternalFlow
    from services.native_nav import NativeLedger
    from tests.test_native_nav import _dense

    return NativeLedger(
        native_pnl={"BTC": _dense([3.0, 3.479214])},
        terminal_native_equity={"BTC": 0.5},
        marks={"BTC": _dense([88000.0, 88000.0])},
        native_flows=[ExternalFlow("2026-01-02", -570000.0, "BTC", -6.479202)],
        terminal_upnl_native={},
        full_history=True,
    )


def _refusal_state() -> DeribitNativeAccountState:
    return DeribitNativeAccountState(
        native_equity={"BTC": 0.5}, native_upnl={}, collapsed_equity_usd=100_000.0,
        collapsed_upnl_usd=0.0, balance_error=False, upnl_unreadable=False,
        native_options_value={},
        native_balance={"BTC": 0.4},
        summary_snapshot={"BTC": {"equity": 0.5, "balance": 0.4}},
        index_usd_snapshot={"BTC": 88000.0},
        read_at_iso="2026-10-09T05:30:00+00:00",
    )


def _upserts(capture: dict, kind_prefix: str) -> list[dict]:
    return [
        payload
        for name, payload, _oc in capture["upserts"]
        if name == "allocator_equity_derived"
        and isinstance(payload, dict)
        and str(payload.get("kind", "")).startswith(kind_prefix)
    ]


async def _run_refused_derive(
    *,
    combine: Any = None,
    build_effect: BaseException | None = None,
    report: Any = None,
    fail_capture_upsert: bool = False,
) -> tuple[Any, dict]:
    """A key-mode Deribit derive that is turned away. ``combine=None`` runs the REAL
    ``combine_native_ledger`` over the breaching ledger, so the gate and the diagnostic are the
    production ones."""
    from unittest.mock import patch

    from services.broker_dailies import combine_native_ledger as real_combine
    from services.deribit_ingest import deribit_ledger_digest
    from services.job_worker import run_derive_broker_dailies_job
    from tests.test_mtm_single_key import _apply, _base_patches, _ctx, _recording_ledger, _report

    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    if fail_capture_upsert:
        original = ctx.supabase.table.side_effect

        def _table(name: str) -> Any:
            tbl = original(name)
            real_upsert = tbl.upsert.side_effect

            def _upsert(payload: object, **kw: object) -> Any:
                if isinstance(payload, dict) and str(payload.get("kind", "")).startswith(
                    "key_capture:"
                ):
                    raise RuntimeError("db down: secret-0.123456-BTC")
                return real_upsert(payload, **kw)

            tbl.upsert.side_effect = _upsert
            return tbl

        ctx.supabase.table.side_effect = _table

    rep = report or _report(has_option_activity=False)
    if rep.ledger_digest is None:
        rep.ledger_digest = deribit_ledger_digest(_ROWS)
    if build_effect is not None:
        ledger_mock, _calls = _recording_ledger([rep], side_effects=[build_effect])
    else:
        ledger = _breaching_ledger()
        ledger_mock = AsyncMock(return_value=(ledger, rep))
    patches = _base_patches(
        ctx, key_mode=True, ledger_mock=ledger_mock,
        combine_mock=combine or real_combine,
        state_spy=AsyncMock(return_value=_refusal_state()),
    )
    with _apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-drb"}
        )
    return result, capture


@pytest.mark.asyncio
async def test_a_refused_derive_still_stores_what_it_read() -> None:
    """MD-01, the section 5 gate. The derive still returns FAILED as before, and now ALSO
    stores the summaries read, the ledger digest and the inception diagnostic (computed
    although the gate refused) on its own ``key_capture`` row."""
    from services.job_worker import DispatchOutcome

    result, capture = await _run_refused_derive()
    assert result.outcome == DispatchOutcome.FAILED and result.error_kind == "permanent"

    [row] = _upserts(capture, "key_capture:")
    assert row["kind"] == "key_capture:key-drb"
    assert row["allocator_id"] == "alloc-1"
    payload = row["payload"]
    assert payload["outcome"] == "refused"
    assert payload["refusal_class"] == "InceptionReconciliationError"
    assert payload["venue"] == "deribit"
    assert isinstance(payload["captured_at"], str) and payload["captured_at"]
    # The three captures, each read back through its strict reader.
    summary = read_account_summary(payload)
    assert summary is not None and summary["summaries"][0]["currency"] == "BTC"
    assert read_ledger_digest(payload) is not None
    from services.allocator_equity_derive import read_native_inception_diagnostics

    diag = read_native_inception_diagnostics(payload)
    assert diag is not None
    # 0.5 BTC at 88000 is a material residual: the diagnostic reports the breach the gate saw.
    assert diag["breach_ratio_current"] > 1
    assert json.dumps(payload, allow_nan=False)  # JSONB-safe


@pytest.mark.asyncio
async def test_a_refused_derive_never_writes_key_inputs() -> None:
    """MD-01 / T-33: the compose reads ``key_inputs`` for flows and the anchor. A refused
    derive's partial capture must not replace the last good derive's."""
    _result, capture = await _run_refused_derive()
    assert _upserts(capture, "key_inputs:") == []
    # And nothing else the refusal would have written alongside a success.
    assert [n for n, _p, _o in capture["upserts"] if n == "csv_daily_returns"] == []


@pytest.mark.asyncio
async def test_a_successful_derive_writes_key_inputs_and_no_key_capture() -> None:
    """The capture row is for refusals only; a good derive keeps writing the three fields
    onto ``key_inputs`` exactly as before."""
    capture = await _run_success_capture()
    assert _upserts(capture, "key_capture:") == []
    [row] = _upserts(capture, "key_inputs:")
    assert read_account_summary(row["payload"]) is not None


async def _run_success_capture() -> dict:
    import pandas as pd

    from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
    from tests.test_mtm_single_key import (
        _apply,
        _base_patches,
        _ctx,
        _ledger_meta,
        _recording_ledger,
        _report,
    )

    returns = pd.Series(
        [0.01, -0.02, 0.03], index=pd.DatetimeIndex(["2024-05-01", "2024-05-02", "2024-05-03"])
    )
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    ledger_mock, _calls = _recording_ledger([_report(has_option_activity=False)])
    combine = MagicMock(return_value=(returns, _ledger_meta()))
    with _apply(
        _base_patches(
            ctx, key_mode=True, ledger_mock=ledger_mock, combine_mock=combine,
            state_spy=AsyncMock(return_value=_refusal_state()),
        )
    ):
        result = await run_derive_broker_dailies_job(
            {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-drb"}
        )
    assert result.outcome == DispatchOutcome.DONE
    return capture


@pytest.mark.asyncio
async def test_a_failing_capture_upsert_keeps_the_original_refusal_and_is_not_silent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The capture is additive: if ITS upsert fails the derive still returns the original
    FAILED disposition and message, and one WARNING names the exception class only."""
    from services.job_worker import DispatchOutcome

    baseline, _ = await _run_refused_derive()
    with caplog.at_level("WARNING"):
        result, capture = await _run_refused_derive(fail_capture_upsert=True)
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == baseline.error_kind == "permanent"
    assert result.error_message == baseline.error_message
    assert _upserts(capture, "key_capture:") == []
    warnings = [r for r in caplog.records if "key_capture" in r.getMessage()]
    assert len(warnings) == 1
    text = warnings[0].getMessage()
    assert "RuntimeError" in text and "deribit" in text
    assert "secret" not in text and "0.123456" not in text  # class name only, never the message


@pytest.mark.asyncio
async def test_each_structural_refusal_after_the_read_is_captured_with_its_class() -> None:
    """The other refusals that return FAILED after the summaries read: an unmarkable
    currency, a row that cannot be valued (the ledger never finished, so only the summaries
    read exists), and the empty-ledger refusal."""
    import dataclasses

    from services.deribit_txn import LedgerValuationError
    from services.native_nav import UnmarkableCurrencyError
    from tests.test_mtm_single_key import _report

    # An unmarkable currency raised by the combine.
    result, capture = await _run_refused_derive(
        combine=MagicMock(
            side_effect=UnmarkableCurrencyError(
                currency="BTC", venue="deribit", reason="no_mark", missing_day_count=1
            )
        )
    )
    assert result.error_kind == "permanent"
    [row] = _upserts(capture, "key_capture:")
    assert row["payload"]["refusal_class"] == "UnmarkableCurrencyError"
    assert read_account_summary(row["payload"]) is not None
    assert read_ledger_digest(row["payload"]) is not None

    # A valuation refusal out of the crawl: the ledger never existed, the read did.
    result, capture = await _run_refused_derive(build_effect=LedgerValuationError("bad row"))
    assert result.error_kind == "permanent"
    [row] = _upserts(capture, "key_capture:")
    assert row["payload"]["refusal_class"] == "LedgerValuationError"
    assert read_account_summary(row["payload"]) is not None
    assert "ledger_digest" not in row["payload"]
    assert "native_inception_diagnostics" not in row["payload"]

    # The empty-ledger refusal: material equity, zero return-bearing rows.
    empty = dataclasses.replace(_report(has_option_activity=False), total_return_rows=0)
    result, capture = await _run_refused_derive(report=empty)
    assert result.error_kind == "permanent"
    [row] = _upserts(capture, "key_capture:")
    assert row["payload"]["refusal_class"] == "EmptyLedgerRefusal"
    assert read_account_summary(row["payload"]) is not None
    assert read_ledger_digest(row["payload"]) is not None
    assert _upserts(capture, "key_inputs:") == []
