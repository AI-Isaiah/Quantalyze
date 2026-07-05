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
    MAX_TXN_SAMPLES_PER_TYPE,
    _build_history_params,
    _paginate_trades,
    _redact_secret_values,
    assert_sanitized,
    classify_instrument,
    sanitize_evidence,
    scope_is_read_only,
    summarize_txn_log,
)


# ---------------------------------------------------------------------------
# _paginate_trades — IN-8 same-ms cluster stall guard
# ---------------------------------------------------------------------------


class _StallExchange:
    """Fake exchange that always returns the SAME same-millisecond cluster with
    has_more=True — the pathological shape where a cluster larger than `count`
    pins the cursor and every page re-fetches identical rows."""

    def __init__(self, ts_ms: int) -> None:
        self.calls = 0
        self._page = {
            "result": {
                "trades": [
                    {"trade_id": "t1", "timestamp": ts_ms, "instrument_name": "BTC-PERPETUAL"},
                    {"trade_id": "t2", "timestamp": ts_ms, "instrument_name": "BTC-PERPETUAL"},
                ],
                "has_more": True,
            }
        }

    async def private_get_get_user_trades_by_currency_and_time(self, params: dict) -> dict:
        self.calls += 1
        return self._page


async def test_paginate_trades_breaks_on_same_ms_cluster_stall() -> None:
    ts = 1_600_000_000_000
    ex = _StallExchange(ts)
    out = await _paginate_trades(
        ex, "BTC", start_ms=ts, end_ms=ts + 1, count=2, max_pages=500
    )
    # The stall is surfaced, NOT silently spun to max_pages.
    assert out["boundary_overlap_stall"] is True
    assert out["max_pages_hit"] is False
    # Distinct ids only — the re-fetched duplicate page adds nothing.
    assert out["trade_count"] == 2
    # It broke on the 2nd page (page 1 = all-new, page 2 = zero-new stall),
    # nowhere near the 500-page ceiling.
    assert ex.calls == 2


# ---------------------------------------------------------------------------
# _redact_secret_values — CR-1 belt-and-braces credential redaction
# ---------------------------------------------------------------------------


def test_redact_secret_values_strips_bare_credential() -> None:
    # A ccxt error can echo the raw client_secret with NO `client_secret=`
    # prefix (e.g. inside a URL or JSON body). scrub_freeform_string alone
    # would miss that shape; the literal-value substitution guarantees it is
    # gone. Value is obviously-synthetic (gitleaks-safe).
    secret = "SYNTHETIC_NOT_A_REAL_SECRET_00000"
    client_id = "SYNTHETIC_CLIENT_ID_11111"
    msg = f"400 Bad Request: {{\"grant\":\"{secret}\",\"id\":\"{client_id}\"}}"
    out = _redact_secret_values(msg, client_id, secret)
    assert secret not in out
    assert client_id not in out
    assert "[REDACTED]" in out


def test_redact_secret_values_tolerates_none() -> None:
    # None credentials (env unset) must not raise and must leave text intact.
    assert _redact_secret_values("plain message", None, None) == "plain message"


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

    # Samples are now a LIST per type (capped, kind-diverse) — the widened
    # harness keeps up to MAX_TXN_SAMPLES_PER_TYPE per type so the live evidence
    # can characterize the row shape, not just a single sample.
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
        # widened Wave-0 field set:
        "index_price",
        "mark_price",
        "price",
        "id",
        "trade_id",
        "user_seq",
    }
    for sample_list in samples.values():
        assert isinstance(sample_list, list)
        assert len(sample_list) <= MAX_TXN_SAMPLES_PER_TYPE
        for sample in sample_list:
            # ONLY whitelisted fields — no PII keys leak into a committed sample.
            assert set(sample).issubset(whitelist)
            assert "username" not in sample
            assert "user_id" not in sample
            assert "email" not in sample


def test_txnlog_summary_empty_rows() -> None:
    summary = summarize_txn_log([])
    assert summary["type_counts"] == {}
    assert summary["type_samples"] == {}
    assert summary["txn_trade_row_count"] == 0
    assert summary["settlement_price_stats"] == {
        "total": 0,
        "index_price_present": 0,
        "mark_price_present": 0,
    }
    assert summary["trade_cashflow_stats"] == {}


def test_txnlog_passes_through_new_whitelist_fields() -> None:
    # The six Wave-0 fields (index_price/mark_price/price/id/trade_id/user_seq)
    # must survive into the sample so A1 (event-time price presence) and the
    # native `id` funding-dedup axis are OBSERVABLE in the committed evidence.
    row = _txn_row(
        "settlement",
        index_price=61000.0,
        mark_price=61010.0,
        price=61005.0,
        id=123456789,
        trade_id="ETH-987654",
        user_seq=42,
    )
    summary = summarize_txn_log([row])
    sample = summary["type_samples"]["settlement"][0]
    assert sample["index_price"] == 61000.0
    assert sample["mark_price"] == 61010.0
    assert sample["price"] == 61005.0
    assert sample["id"] == 123456789
    assert sample["trade_id"] == "ETH-987654"
    assert sample["user_seq"] == 42


def test_settlement_price_stats_counts_presence_not_a_single_sample() -> None:
    # A1 is NUMERIC: over N type=settlement rows, how many carry index_price /
    # mark_price. A single sample cannot answer "are these POPULATED"; the
    # per-account presence counts can. K=2 carry index, M=1 carries mark.
    rows = [
        _txn_row("settlement", index_price=60000.0, mark_price=None),
        _txn_row("settlement", index_price=61000.0, mark_price=61010.0),
        _txn_row("settlement", index_price=None, mark_price=None),
        # a non-settlement row must not be counted in settlement stats:
        _txn_row("trade", index_price=99999.0, mark_price=99999.0),
    ]
    # drop the mark_price key entirely on one row (absent, not just None):
    del rows[0]["mark_price"]
    summary = summarize_txn_log(rows)
    assert summary["settlement_price_stats"] == {
        "total": 3,
        "index_price_present": 2,
        "mark_price_present": 1,
    }


def test_trade_cashflow_stats_per_kind_is_the_a3_answer() -> None:
    # A3: do inverse-perp type=trade rows carry nonzero cashflow (double-count
    # risk vs settlement)? The answer is per-classify-kind {total, nonzero}.
    rows = [
        _txn_row("trade", instrument_name="BTC-PERPETUAL", cashflow=0.0),
        _txn_row("trade", instrument_name="BTC-PERPETUAL", cashflow=0.0),
        _txn_row("trade", instrument_name="ETH-PERPETUAL", cashflow=0.5),
        # linear-perp trade with cashflow — a distinct kind bucket:
        _txn_row("trade", instrument_name="BTC_USDC-PERPETUAL", cashflow=1.0),
        # a settlement row must NOT enter trade_cashflow_stats:
        _txn_row("settlement", instrument_name="BTC-PERPETUAL", cashflow=2.0),
    ]
    summary = summarize_txn_log(rows)
    stats = summary["trade_cashflow_stats"]
    assert stats["inverse_perpetual"] == {"total": 3, "cashflow_nonzero": 1}
    assert stats["linear_perpetual"] == {"total": 1, "cashflow_nonzero": 1}
    # settlement rows are excluded from the trade cashflow partition entirely.
    assert sum(s["total"] for s in stats.values()) == 4


def test_per_type_field_stats_is_the_cashflow_vs_change_reprobe_answer() -> None:
    # Re-probe: does realized cash (esp. fees) live in `cashflow` or `change`?
    # A cashflow-only sum silently drops any cash booked into `change`. The
    # per-type stat must count, per distinct type: nonzero cashflow, nonzero
    # change, and rows where the two DIFFER (the fee-in-change signal). It also
    # settles negative_balance_fee / options_settlement_summary as
    # cash-bearing-vs-informational.
    # Deribit returns numeric fields as STRINGS (incl. sci-notation) — the stat
    # must coerce them (float), else every count is a spurious zero.
    rows = [
        # trade with a fee booked ONLY in `change` (cashflow==0) — the exact
        # dropped-fee case the re-probe exists to detect. Sci-notation string.
        _txn_row("trade", cashflow="0.0", change="-3e-4"),
        # trade where cashflow and change agree (no hidden cash), string-typed.
        _txn_row("trade", cashflow="0.5", change="0.5"),
        # a fee-type row: nonzero change, cashflow absent entirely.
        {"type": "negative_balance_fee", "change": "-1.6328e-4"},
        # an options settlement summary carrying NO cash (informational).
        {"type": "options_settlement_summary", "cashflow": "0.0", "change": "0.0"},
    ]
    stats = summarize_txn_log(rows)["per_type_field_stats"]
    assert stats["trade"] == {
        "total": 2,
        "cashflow_nonzero": 1,
        "change_nonzero": 2,
        "cashflow_ne_change": 1,
        "cashflow_sum": pytest.approx(0.5),
        "change_sum": pytest.approx(0.5 - 3e-4),
    }
    assert stats["negative_balance_fee"] == {
        "total": 1,
        "cashflow_nonzero": 0,
        "change_nonzero": 1,
        "cashflow_ne_change": 0,
        "cashflow_sum": pytest.approx(0.0),
        "change_sum": pytest.approx(-1.6328e-4),
    }
    assert stats["options_settlement_summary"] == {
        "total": 1,
        "cashflow_nonzero": 0,
        "change_nonzero": 0,
        "cashflow_ne_change": 0,
        "cashflow_sum": pytest.approx(0.0),
        "change_sum": pytest.approx(0.0),
    }


def test_txn_trade_row_count_is_the_honesty_anchor_stream() -> None:
    # Pitfall 5: the txn-log type=trade count is the completeness stream the
    # D-02 gate anchors to (the trades endpoint under-returns). It must be a
    # distinct count of type=="trade" rows, roll-up-able across scopes.
    rows = [
        _txn_row("trade"),
        _txn_row("trade"),
        _txn_row("settlement"),
        _txn_row("deposit"),
        _txn_row("trade"),
    ]
    assert summarize_txn_log(rows)["txn_trade_row_count"] == 3


def test_type_samples_capped_at_5_and_kind_diverse() -> None:
    # Under the cap the summary must keep at least one sample per observed
    # instrument kind (so a late-appearing kind is never crowded out by a
    # duplicate-kind flood — otherwise the evidence misrepresents the mix).
    rows = [
        _txn_row("trade", instrument_name="BTC-PERPETUAL"),  # inverse
        _txn_row("trade", instrument_name="ETH-PERPETUAL"),  # inverse
        _txn_row("trade", instrument_name="BTC-PERPETUAL"),  # inverse
        _txn_row("trade", instrument_name="ETH-PERPETUAL"),  # inverse
        _txn_row("trade", instrument_name="BTC-PERPETUAL"),  # inverse (fills 5)
        _txn_row("trade", instrument_name="BTC_USDC-PERPETUAL"),  # linear (late)
        _txn_row("trade", instrument_name="BTC-27MAR26-60000-C"),  # option (late)
    ]
    samples = summarize_txn_log(rows)["type_samples"]["trade"]
    assert len(samples) <= MAX_TXN_SAMPLES_PER_TYPE
    kinds = {classify_instrument(str(s["instrument_name"])) for s in samples}
    # Every observed kind survived the cap (diversity preserved on replacement).
    assert kinds == {"inverse_perpetual", "linear_perpetual", "option"}


def test_summarize_txn_log_never_raises_on_malformed_rows() -> None:
    # Untrusted exchange input — a non-mapping row must be skipped, not crash.
    rows = [None, 42, "junk", {"type": "trade"}]
    summary = summarize_txn_log(rows)
    assert summary["type_counts"] == {"trade": 1}
    assert summary["txn_trade_row_count"] == 1


# ---------------------------------------------------------------------------
# _build_history_params — subaccount_id inclusion rule (A2), I/O-free
# ---------------------------------------------------------------------------


def test_build_history_params_includes_subaccount_id_only_when_present() -> None:
    base = {"currency": "BTC", "count": 1000}
    # Main scope (None) — subaccount_id MUST be absent.
    main = _build_history_params(base, None)
    assert "subaccount_id" not in main
    assert main == base
    # Sub scope — subaccount_id present with the exact int.
    sub = _build_history_params(base, 7)
    assert sub["subaccount_id"] == 7
    assert sub["currency"] == "BTC"
    # Pure: the base dict is not mutated.
    assert "subaccount_id" not in base


# classify_instrument behavior tests now live in a single home in
# tests/test_deribit_txn.py (the classifier was lifted to services.deribit_txn,
# D-05). This module keeps only its own harness-specific use of the imported
# classifier (the summarize_txn_log kind-diversity assertion above).


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


def test_sanitize_masks_id_key_after_whitelist_widening() -> None:
    # The Wave-0 whitelist now lets an "id" field through summarize_txn_log; the
    # sanitization boundary must still MASK a string "id" value (***last4) so the
    # widened whitelist cannot defeat masking (T-70-01). "id" stays in _MASK_KEYS.
    clean = sanitize_evidence({"id": "abcdef123456", "instrument_name": "BTC-PERPETUAL"})
    assert clean["id"].startswith("***")
    assert clean["id"] != "abcdef123456"
    # Non-masked sibling data survives untouched.
    assert clean["instrument_name"] == "BTC-PERPETUAL"


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
