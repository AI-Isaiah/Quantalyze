"""SFOX-06 fixture parity suite — the CI-carrying ground-truth gate.

The live prod-key parity run is founder-gated on Phase-121 egress
(``tests/test_sfox_ground_truth_live.py``, skipIf). THIS suite carries the
code-complete gate offline: a hand-built CONSISTENT account passes; two TAMPERED
accounts PROVE fail-loud (``pytest.raises`` — never assumed); the oracle's P115
independence is pinned by signature + comment-stripped source scan; and the
sanitization boundary is proven to RAISE on a planted token.

P115 discipline (money-math oracles pin ECONOMICS, never the impl's own formula):
every fixture number is HAND-DERIVED in a comment and written as a literal —
none is produced by running the harness and re-asserting its own output. The
fixtures use a 100%-liquid-USD account so the A2 cash-vs-MTM interpretations
COINCIDE (``account_balance`` == ``usd_value`` when correct); any divergence is
then unambiguous corruption, not the A2 ambiguity the founder run resolves. A
separate cash-only fixture exercises the A2 flag path (flag, never auto-fail).
"""
from __future__ import annotations

import inspect
import re

import pandas as pd
import pytest

from scripts.sfox_ground_truth import (
    ParityDivergenceError,
    assert_sanitized,
    check_parity,
    reconstruct_equity_from_transactions,
    sanitize_evidence,
)


def _ms(day: str, *, secs: int = 0) -> int:
    """UTC-midnight (+ optional seconds) epoch-ms for a 'YYYY-MM-DD' day."""
    return int(pd.Timestamp(day, tz="UTC").timestamp() * 1000) + secs * 1000


def _bh(day: str, usd_value: str) -> dict:
    return {"timestamp": _ms(day), "usd_value": usd_value}


# ---------------------------------------------------------------------------
# CONSISTENT fixture — a 100%-liquid-USD account whose two INDEPENDENT streams
# (balance-history usd_value + transactions running account_balance) agree by
# construction. A single +500 deposit on 01-03 is the sole external flow.
#
# HAND-DERIVED true daily equity (account_balance == usd_value each EOD):
#   01-01  1000.00   (inception)
#   01-02  1010.00   (+10 real PnL)
#   01-03  1515.00   (+500 deposit, +5 real PnL)
#   01-04  1500.15   (-14.85 real PnL)
# HAND-DERIVED cashflow-neutral returns (deposit removed from the numerator):
#   day0 = 0.0 anchor
#   day1 = (1010 - 1000)/1000                 = 0.01
#   day2 = (1515 - 1010 - 500)/1010 = 5/1010  = 0.004950495049504950
#   day3 = (1500.15 - 1515)/1515 = -14.85/1515= -0.009801980198019801
# ---------------------------------------------------------------------------
_CONSISTENT_BH = [
    _bh("2026-01-01", "1000"),
    _bh("2026-01-02", "1010"),
    _bh("2026-01-03", "1515"),
    _bh("2026-01-04", "1500.15"),
]
_CONSISTENT_TXNS = [
    # buy/sell are internal rotations (excluded from flows) but carry the running
    # account_balance the oracle rolls forward.
    {"id": 1, "action": "buy", "currency": "BTC", "amount": "0.01",
     "timestamp": _ms("2026-01-01"), "account_balance": "1000"},
    {"id": 2, "action": "sell", "currency": "BTC", "amount": "0.01",
     "timestamp": _ms("2026-01-02"), "account_balance": "1010"},
    {"id": 3, "action": "deposit", "currency": "USD", "amount": "500",
     "timestamp": _ms("2026-01-03"), "account_balance": "1010"},
    # later same-day row → EOD account_balance for 01-03 is 1515.
    {"id": 4, "action": "buy", "currency": "BTC", "amount": "0.02",
     "timestamp": _ms("2026-01-03", secs=3600), "account_balance": "1515"},
    {"id": 5, "action": "sell", "currency": "BTC", "amount": "0.02",
     "timestamp": _ms("2026-01-04"), "account_balance": "1500.15"},
]


def test_consistent_fixture_parity_holds_and_resolves_a2_total_mtm():
    """The consistent account: the two independent streams agree everywhere, so
    parity HOLDS (no raise), A2 resolves to total-MTM, and A3's prev0 convention
    holds — the exit-0 path."""
    evidence = check_parity(_CONSISTENT_BH, _CONSISTENT_TXNS)

    assert evidence["parity"]["material_divergence_days"] == []
    assert evidence["parity"]["max_cross_stream_residual"] == pytest.approx(0.0, abs=1e-9)
    assert evidence["a2_account_balance_semantics"]["verdict"] == "total_mtm_reconciles"
    assert evidence["a2_account_balance_semantics"]["total_mtm_reconciles"] is True
    # A3: first balance-history anchor (1000) == transactions inception (1000).
    assert evidence["a3_inception_convention"]["inception_residual"] == pytest.approx(
        0.0, abs=1e-9
    )
    assert evidence["a3_inception_convention"]["prev0_convention_holds"] is True
    assert evidence["requires_founder_decision"] is False


def test_oracle_returns_are_hand_derived_cashflow_neutral():
    """The INDEPENDENT oracle (transactions-only) books the +500 deposit day at
    its REAL PnL (~0.495%), never the deposit (~50%). Numbers hand-derived above;
    the oracle never sees usd_value."""
    oracle = reconstruct_equity_from_transactions(_CONSISTENT_TXNS)
    returns = oracle["returns"]
    assert returns.iloc[0] == pytest.approx(0.0, abs=1e-12)
    assert returns.iloc[1] == pytest.approx(0.01, abs=1e-12)
    assert returns.iloc[2] == pytest.approx(0.004950495049504950, abs=1e-12)
    assert returns.iloc[3] == pytest.approx(-0.009801980198019801, abs=1e-12)
    # Deposit day categorically NOT ~50%.
    assert abs(returns.iloc[2]) < 0.01
    assert oracle["inception_capital"] == pytest.approx(1000.0, abs=1e-12)


# ---------------------------------------------------------------------------
# TAMPERED fixture A — one usd_value point inflated 5% (01-02: 1010 -> 1060.5).
# The independent account_balance stream is UNCHANGED, so the valuation lie
# surfaces as a cross-stream divergence: Δusd_value(01-02)=60.5 vs
# Δaccount_balance(01-02)=10 → residual 50.5 (>> the $5 materiality floor).
# ---------------------------------------------------------------------------
def test_tampered_usd_value_point_fails_loud():
    """Anchor-consistency catches valuation tampering: an inflated balance-history
    point diverges from the independent account_balance oracle → RAISE (the wrong
    curve is never displayed)."""
    tampered_bh = [
        _bh("2026-01-01", "1000"),
        _bh("2026-01-02", "1060.5"),  # 1010 * 1.05 — the 5% inflation
        _bh("2026-01-03", "1515"),
        _bh("2026-01-04", "1500.15"),
    ]
    with pytest.raises(ParityDivergenceError):
        check_parity(tampered_bh, _CONSISTENT_TXNS)


# ---------------------------------------------------------------------------
# TAMPERED fixture B — the +500 deposit is HIDDEN from the transactions ledger:
# no deposit row AND the running account_balance never reflects it (it only rolls
# the +5/-14.85 trading PnL), while balance-history STILL shows the real +500 jump.
# HAND-DERIVED account_balance without the deposit:
#   01-01 1000  01-02 1010  01-03 1015 (=1010+5 PnL)  01-04 1000.15 (=1015-14.85)
# Series-under-test books the usd_value jump as a fake +50% return
#   (1515-1010-0)/1010 = 0.5 ; the oracle books the true +0.495%
#   (1015-1010-0)/1010 = 0.00495 → cross-stream residual ~500 → RAISE.
# (A hidden deposit would otherwise ship as fabricated return.)
# ---------------------------------------------------------------------------
def test_dropped_deposit_row_fails_loud():
    """A deposit present in balance-history but hidden from the transactions
    ledger (row dropped, running balance never saw it) → the reconstruction would
    book it as fake return; the independent oracle exposes it → RAISE."""
    hidden_deposit_txns = [
        {"id": 1, "action": "buy", "currency": "BTC", "amount": "0.01",
         "timestamp": _ms("2026-01-01"), "account_balance": "1000"},
        {"id": 2, "action": "sell", "currency": "BTC", "amount": "0.01",
         "timestamp": _ms("2026-01-02"), "account_balance": "1010"},
        # 01-03: trade only, NO deposit → account_balance 1015 (not 1515).
        {"id": 3, "action": "buy", "currency": "BTC", "amount": "0.02",
         "timestamp": _ms("2026-01-03"), "account_balance": "1015"},
        {"id": 4, "action": "sell", "currency": "BTC", "amount": "0.02",
         "timestamp": _ms("2026-01-04"), "account_balance": "1000.15"},
    ]
    with pytest.raises(ParityDivergenceError):
        check_parity(_CONSISTENT_BH, hidden_deposit_txns)


# ---------------------------------------------------------------------------
# A2 cash-only pattern — account_balance is a USD *cash* running balance that is
# piecewise-constant between cashflow events (jumps only on the 01-03 deposit),
# while usd_value marks the held crypto daily. The two reconcile at the cashflow
# event but differ day-to-day — the A2 ambiguity the FOUNDER run resolves. It is
# FLAGGED requires_founder_decision, NEVER auto-failed.
# HAND-DERIVED: account_balance (cash) 1000,1000,1500,1500 ; usd_value (total MTM)
#   1000,1100,1600,1650 (+500 deposit on 01-03).
# ---------------------------------------------------------------------------
def test_cash_only_account_balance_flags_founder_decision_not_raise():
    """A cash-only account_balance (flat between cashflow events) diverges from
    the daily-marked usd_value, but reconciles at the deposit event → at least one
    interpretation holds → FLAG requires_founder_decision, exit-0 (never guessed,
    never auto-failed)."""
    cash_only_bh = [
        _bh("2026-01-01", "1000"),
        _bh("2026-01-02", "1100"),
        _bh("2026-01-03", "1600"),
        _bh("2026-01-04", "1650"),
    ]
    cash_only_txns = [
        {"id": 1, "action": "buy", "currency": "BTC", "amount": "0.01",
         "timestamp": _ms("2026-01-01"), "account_balance": "1000"},
        {"id": 2, "action": "buy", "currency": "BTC", "amount": "0.01",
         "timestamp": _ms("2026-01-02"), "account_balance": "1000"},
        {"id": 3, "action": "deposit", "currency": "USD", "amount": "500",
         "timestamp": _ms("2026-01-03"), "account_balance": "1500"},
        {"id": 4, "action": "buy", "currency": "BTC", "amount": "0.01",
         "timestamp": _ms("2026-01-04"), "account_balance": "1500"},
    ]
    evidence = check_parity(cash_only_bh, cash_only_txns)  # must NOT raise
    a2 = evidence["a2_account_balance_semantics"]
    assert a2["verdict"] == "cash_only_pattern_requires_founder"
    assert a2["account_balance_moves_off_event"] is False
    assert evidence["requires_founder_decision"] is True


# ---------------------------------------------------------------------------
# Oracle independence pins (P115 — signature + source scan).
# ---------------------------------------------------------------------------
def test_oracle_signature_takes_only_transactions():
    """The oracle's ONLY parameter is the transactions row list — it structurally
    cannot receive usd_value / balance-history."""
    params = list(inspect.signature(reconstruct_equity_from_transactions).parameters)
    assert params == ["transactions"]


def test_oracle_body_never_references_usd_value_or_balance_history():
    """Comment-stripped source scan: the oracle body references neither usd_value
    nor balance_history (a self-referential oracle would pin the impl's formula)."""
    src = inspect.getsource(reconstruct_equity_from_transactions)
    # Drop the docstring, then full-line and inline comments.
    doc = inspect.getdoc(reconstruct_equity_from_transactions) or ""
    for line in doc.splitlines():
        src = src.replace(line, "")
    stripped = "\n".join(
        ln for ln in src.splitlines() if not ln.lstrip().startswith("#")
    )
    stripped = re.sub(r"#.*", "", stripped)
    assert stripped.count("usd_value") == 0
    assert stripped.count("balance_history") == 0


# ---------------------------------------------------------------------------
# Sanitization boundary — the evidence is sanitize-clean; a planted token RAISES.
# ---------------------------------------------------------------------------
def test_fixture_evidence_passes_assert_sanitized():
    """The real fixture evidence survives the sanitize + assert_sanitized re-walk
    (no unmasked token/email/deny-key)."""
    evidence = check_parity(_CONSISTENT_BH, _CONSISTENT_TXNS)
    clean = sanitize_evidence(evidence)
    assert_sanitized(clean)  # must not raise


def test_planted_token_makes_assert_sanitized_raise():
    """A token-shaped string planted into the evidence is caught by the
    assert_sanitized re-walk (the Bearer-leak guard actually fires)."""
    evidence = check_parity(_CONSISTENT_BH, _CONSISTENT_TXNS)
    evidence["parity"]["leaked"] = "A" * 48  # 48-char opaque token shape
    with pytest.raises(ValueError):
        assert_sanitized(evidence)
