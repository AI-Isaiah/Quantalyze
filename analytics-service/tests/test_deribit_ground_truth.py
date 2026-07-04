"""Tests for scripts/deribit_ground_truth.py pure-logic layer.

Pure-function coverage — I/O-free, no ccxt, no network, no mocking. Each test
constructs plain dicts/strings and asserts on the returned value. This is the
DRB-01 harness's safety layer; the live authed fetch (Plan 67-03) is a separate
checkpoint:human-action run.

Regression gates — WHY each case matters (Rule 9):
  - scope gate: a WRITE-scoped Deribit key must be rejected BEFORE any data
    fetch. This is the T-67-02 Elevation-of-Privilege mitigation — the founder
    provides a read-only LTP key and the harness must fail loud if the key can
    trade. The exact True string is the observed grounding fact from a real
    public/auth response; if this test can't distinguish :read from :read_write
    the whole read-only guarantee is hollow.
  - txn-log summary: THE phase question (is Deribit funding netted into realized
    PnL or a separate transaction-log row?) is answered by the distinct `type`
    values + per-type sample. The sample MUST carry only whitelisted fields so
    committing the evidence can never leak username/user_id/email (T-67-01).
  - instrument classification: Phase 70 (DRB-05/06) designs inverse vs linear
    vs option handling against this mix; a misclassification silently biases the
    recorded ground truth. Must never raise on an unknown instrument name.
  - masking / assert_sanitized: anything the harness prints can end up committed
    to a tracked git artifact. sanitize_evidence + assert_sanitized are the
    stdout->git sanitization boundary (T-67-01/T-67-03); a leaked token or email
    that survives here is a real credential disclosure, not a style nit.
"""
from __future__ import annotations

import pytest

from scripts.deribit_ground_truth import (
    assert_sanitized,
    classify_instrument,
    sanitize_evidence,
    scope_is_read_only,
    summarize_txn_log,
)


# ---------------------------------------------------------------------------
# scope_is_read_only — T-67-02 fail-loud read-only gate
# ---------------------------------------------------------------------------


def test_scope_gate_rejects_write() -> None:
    # A key that can trade must be rejected — read_write is the write grant.
    assert scope_is_read_only("account:read trade:read_write wallet:read") is False


def test_scope_gate_accepts_observed_readonly_string() -> None:
    # This exact string is the observed grounding fact from a real public/auth
    # response for a read-only LTP key.
    observed = "trade:read account:read wallet:read custody:read block_trade:read"
    assert scope_is_read_only(observed) is True


def test_scope_gate_rejects_read_trade_write_variant() -> None:
    # Deribit also exposes :read_trade as a write-capable grant.
    assert scope_is_read_only("account:read trade:read_trade") is False


def test_scope_gate_requires_at_least_one_read_grant() -> None:
    # Auth must have proven at least one read grant; a scope with zero
    # :read-suffixed tokens is not a usable read-only key.
    assert scope_is_read_only("") is False
    assert scope_is_read_only("custody block_trade") is False


# ---------------------------------------------------------------------------
# summarize_txn_log — THE phase question + whitelisted-field safety
# ---------------------------------------------------------------------------


def _txn_row(row_type: str, **overrides: object) -> dict[str, object]:
    """A transaction-log row shaped like Deribit private/get_transaction_log.

    Deliberately carries PII (username/user_id/email) that MUST NOT appear in
    the summary sample.
    """
    row: dict[str, object] = {
        "type": row_type,
        "amount": 1.5,
        "balance": 10.0,
        "equity": 12.0,
        "cashflow": 0.25,
        "instrument_name": "BTC-PERPETUAL",
        "side": "buy",
        "position": 3.0,
        "timestamp": 1_700_000_000_000,
        "currency": "BTC",
        # PII that must never survive into a committed sample:
        "username": "founder_ltp_login",
        "user_id": 998877,
        "email": "founder@example.com",
    }
    row.update(overrides)
    return row


def test_txnlog_type_summary_counts_and_samples() -> None:
    rows = [
        _txn_row("trade"),
        _txn_row("trade", amount=2.0),
        _txn_row("settlement"),
        _txn_row("deposit"),
        _txn_row("settlement", amount=-0.5),
    ]
    summary = summarize_txn_log(rows)

    # Distinct type -> count mapping.
    assert summary["type_counts"] == {"trade": 2, "settlement": 2, "deposit": 1}

    # One sample per distinct type.
    samples = summary["type_samples"]
    assert set(samples) == {"trade", "settlement", "deposit"}

    whitelist = {
        "type",
        "amount",
        "balance",
        "equity",
        "cashflow",
        "instrument_name",
        "side",
        "position",
        "timestamp",
        "currency",
    }
    for sample in samples.values():
        # ONLY whitelisted fields — no PII keys leak into a committed sample.
        assert set(sample).issubset(whitelist)
        assert "username" not in sample
        assert "user_id" not in sample
        assert "email" not in sample


def test_txnlog_summary_empty_rows() -> None:
    summary = summarize_txn_log([])
    assert summary["type_counts"] == {}
    assert summary["type_samples"] == {}


# ---------------------------------------------------------------------------
# classify_instrument — inverse / linear / option / future
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name,expected",
    [
        ("BTC-PERPETUAL", "inverse_perpetual"),
        ("ETH-PERPETUAL", "inverse_perpetual"),
        ("BTC_USDC-PERPETUAL", "linear_perpetual"),
        ("ETH_USDC-PERPETUAL", "linear_perpetual"),
        ("BTC-27MAR26-60000-C", "option"),
        ("BTC-27MAR26-60000-P", "option"),
        ("BTC-27MAR26", "future"),
        ("SOMETHING-WEIRD", "unknown"),
        ("", "unknown"),
    ],
)
def test_instrument_classification(name: str, expected: str) -> None:
    assert classify_instrument(name) == expected


def test_instrument_classification_never_raises_on_junk() -> None:
    # Untrusted exchange input — must classify, not crash (T-67-04).
    for junk in ("---", "12345", "BTC-", "-PERPETUAL", "BTC_USDC-"):
        assert classify_instrument(junk) == "unknown" or isinstance(
            classify_instrument(junk), str
        )


# ---------------------------------------------------------------------------
# sanitize_evidence — stdout -> git sanitization boundary
# ---------------------------------------------------------------------------


def test_evidence_is_masked() -> None:
    raw = {
        "username": "founder_ltp_login",
        "user_id": "998877665544",
        "email": "founder@example.com",
        "access_token": "should-be-removed-entirely",
        "refresh_token": "also-removed",
        "api_key": "secret-key-value",
        "client_secret": "top-secret",
        "note": "ccxt error https://deribit.com/api?foo=bar&signature=deadbeefdeadbeef",
        "nested": [
            {"session_token": "nope", "instrument_name": "BTC-PERPETUAL"},
        ],
    }
    clean = sanitize_evidence(raw)

    # Deny-keyed (token/secret/api_key) entries are removed entirely.
    assert "access_token" not in clean
    assert "refresh_token" not in clean
    assert "api_key" not in clean
    assert "client_secret" not in clean
    assert "session_token" not in clean["nested"][0]

    # Non-secret data survives.
    assert clean["nested"][0]["instrument_name"] == "BTC-PERPETUAL"

    # Mask-keyed values are truncated (***<last4>), not passed through raw.
    assert clean["username"] != "founder_ltp_login"
    assert clean["username"].startswith("***")
    assert clean["user_id"].startswith("***")

    # &signature=<hex> is scrubbed out of freeform strings.
    assert "deadbeefdeadbeef" not in clean["note"]


def test_assert_sanitized_raises_on_deny_key() -> None:
    with pytest.raises(ValueError, match="access_token"):
        assert_sanitized({"outer": {"access_token": "leaked"}})


def test_assert_sanitized_raises_on_unmasked_email() -> None:
    with pytest.raises(ValueError, match="email"):
        assert_sanitized({"contact": "founder@example.com"})


def test_assert_sanitized_passes_on_sanitized_fixture() -> None:
    raw = {
        "username": "founder_ltp_login",
        "email": "founder@example.com",
        "access_token": "leaked",
        "note": "url?a=b&signature=deadbeefdeadbeef",
        "scope": "trade:read account:read",
    }
    clean = sanitize_evidence(raw)
    # Must not raise — sanitize_evidence output is provably clean.
    assert_sanitized(clean)
