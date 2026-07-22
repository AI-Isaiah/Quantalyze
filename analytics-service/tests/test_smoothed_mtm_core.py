"""Phase 131 — the ``smoothed_mtm`` third factsheet ``pnl_basis`` (01b wiring).

Cross-layer pins for the smoothed_mtm basis: both basis enums carry the member
(config/compute agreement), the ``txn_rows_to_native_daily`` smoothed branch, the
adapter ΔMTM merge in ``build_deribit_native_ledger``, the smoothed-only identity
channels in ``assert_balance_identity``, and the SC-4 byte-identity keystone.

ADDITIVE: every production hunk these pins protect is gated on
``pnl_basis == 'smoothed_mtm'`` OR option classification — the ``cash_settlement``
and ``mark_to_market`` paths stay BYTE-IDENTICAL (SC-4). The 83-PLAN Task-4/6
DELETIONS are explicitly NOT performed under this third-basis framing.
"""
from __future__ import annotations

import asyncio
from typing import Any

import pandas as pd
import pytest

from services import deribit_ingest as di
from services.allocated_capital import (
    ReturnsDenominatorConfigError,
    _VALID_PNL_BASES,
    parse_returns_denominator_config,
)
from services.deribit_txn import (
    DEFAULT_PNL_BASIS,
    LedgerValuationError,
    PNL_BASIS_CASH_SETTLEMENT,
    PNL_BASIS_MARK_TO_MARKET,
    PNL_BASIS_SMOOTHED_MTM,
    _PNL_BASES,
    txn_rows_to_native_daily,
)


# ===========================================================================
# Task 3 — both basis enums carry smoothed_mtm (config/compute agreement) +
# the use_smoothed branch in txn_rows_to_native_daily.
# ===========================================================================


def test_smoothed_mtm_member_of_both_basis_enums() -> None:
    """Enum-sync pin: PNL_BASIS_SMOOTHED_MTM == 'smoothed_mtm' is a member of BOTH
    deribit_txn._PNL_BASES AND allocated_capital._VALID_PNL_BASES; the DEFAULT is
    UNCHANGED and the two existing members survive (SC-4)."""
    assert PNL_BASIS_SMOOTHED_MTM == "smoothed_mtm"
    assert PNL_BASIS_SMOOTHED_MTM in _PNL_BASES
    assert "smoothed_mtm" in _VALID_PNL_BASES
    # DEFAULT untouched — headline / peer-rank basis stays cash_settlement.
    assert DEFAULT_PNL_BASIS == PNL_BASIS_CASH_SETTLEMENT == "cash_settlement"
    # The two existing members are still present in BOTH enums (no rewrite).
    assert {PNL_BASIS_CASH_SETTLEMENT, PNL_BASIS_MARK_TO_MARKET} <= _PNL_BASES
    assert {"cash_settlement", "mark_to_market"} <= _VALID_PNL_BASES


_SMOOTHED_CONFIG_RAW = {
    "denominator": "allocated_capital",
    "pnl_basis": "smoothed_mtm",
    "capital_schedule": [
        {"effective_from": "2025-08-03", "capital_usd": 4000000},
    ],
    "metrics_basis": "active_day",
}


def test_allocated_capital_config_accepts_smoothed_and_rejects_unknown() -> None:
    """The config-layer validation sites (allocated_capital.py:158/:230) accept
    'smoothed_mtm' via _VALID_PNL_BASES and still reject an unknown basis."""
    cfg = parse_returns_denominator_config(_SMOOTHED_CONFIG_RAW)
    assert cfg is not None
    assert cfg.pnl_basis == "smoothed_mtm"
    bad = {**_SMOOTHED_CONFIG_RAW, "pnl_basis": "realized_only"}
    with pytest.raises(ReturnsDenominatorConfigError):
        parse_returns_denominator_config(bad)


def _ms(iso: str) -> int:
    return int(pd.Timestamp(iso, tz="UTC").timestamp() * 1000)


def _opt_trade(
    *, day: str, change: float, commission: float = 0.01, id: int = 1
) -> dict[str, Any]:
    return {
        "type": "trade",
        "instrument_name": "BTC-14JUL25-60000-C",
        "currency": "BTC",
        "change": change,
        "commission": commission,
        "position": 1.0,
        "timestamp": _ms(f"{day}T10:00:00+00:00"),
        "id": id,
    }


def _summary(*, day: str, rpl: float, upl: float, change: float = 0.0) -> dict[str, Any]:
    return {
        "type": "options_settlement_summary",
        "instrument_name": "BTC-14JUL25-60000-C",
        "currency": "BTC",
        "change": change,
        "realized_pl": rpl,
        "unrealized_pl": upl,
        "timestamp": _ms(f"{day}T08:00:00+00:00"),
        "id": 900,
    }


def test_smoothed_option_row_contributes_full_change() -> None:
    """Under smoothed_mtm an option trade/delivery row books its FULL native
    `change` on its settlement day (the redistribution happens in the adapter's
    ΔMTM channel, Task 4) — identical to cash_settlement's cash channel, NOT the
    coverage-gated −commission arm of mark_to_market. A summary row is present but
    must not reshape the option cash leg."""
    rows = [
        _opt_trade(day="2025-07-13", change=0.05, commission=0.01, id=1),
        _summary(day="2025-07-14", rpl=0.03, upl=-0.01),
    ]
    native = txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM)
    # FULL change booked on the trade day; summary contributes NOTHING.
    assert native == {"BTC": {"2025-07-13": 0.05}}


def test_smoothed_summary_contributes_nothing() -> None:
    """A summary row (realized_pl=0.03, unrealized_pl=-0.01, change==0) under
    smoothed_mtm creates NO native_pnl entry — the summary is a Task-5
    reconciliation cross-check, never an attribution channel."""
    rows = [_summary(day="2025-07-14", rpl=0.03, upl=-0.01)]
    assert txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM) == {}


def test_smoothed_summary_nonzero_change_fails_loud() -> None:
    """The change==0 enforcement on summary rows still fires under smoothed_mtm: a
    nonzero summary `change` is semantics drift → LedgerValuationError (kept
    verbatim from the mark_to_market discipline)."""
    rows = [_summary(day="2025-07-14", rpl=0.03, upl=-0.01, change=0.02)]
    with pytest.raises(LedgerValuationError):
        txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM)


def test_smoothed_cash_channel_byte_identical_to_cash_settlement() -> None:
    """SC-4-adjacent (pure layer): the smoothed cash channel output equals the
    cash_settlement output on an options fixture (the ΔMTM redistribution is
    merged by the adapter, NOT here — the pure aggregator is unchanged between the
    two bases). mark_to_market, by contrast, reshapes the option leg."""
    rows = [
        _opt_trade(day="2025-07-13", change=0.05, commission=0.01, id=1),
        _summary(day="2025-07-14", rpl=0.03, upl=-0.01),
    ]
    cash = txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_CASH_SETTLEMENT)
    smoothed = txn_rows_to_native_daily(rows, pnl_basis=PNL_BASIS_SMOOTHED_MTM)
    assert smoothed == cash
