"""Revert-proof correctness tests for services.deribit_txn (P70 RISKY core).

These tests pin the silent-corruption risks of the Deribit ledger ingestion
BEFORE any I/O code exists (D-05/D-07/D-08 + the P70 re-probe field correction):

  * the daily return sums the `change` field (fee-inclusive cash-balance delta),
    NOT `cashflow` (deferred, fee-EXCLUDED session PnL) — a trade fixture whose
    `cashflow` and `change` differ fails if the sum ever reverts to `cashflow`;
  * inverse coin->USD converts at the row's OWN event-time index_price, with the
    ledger's credit(+)/debit(-) sign trusted verbatim — hand-computed short AND
    long fixtures fail if the sign flips or the multiply drops;
  * linear (_USDC/_USDT/_EURR or USD-currency) `change` passes through as USD
    with NO index multiplication;
  * an inverse row missing its event-time index_price AND any same-day fallback
    fails loud (never a current/period-end price fallback);
  * a cash-bearing row lacking its own index_price (negative_balance_fee) is
    valued via a SAME-UTC-DAY per-currency index built from index-bearing rows;
  * the return-bearing single-sum counts each row's `change` ONCE per UTC day —
    funding is already inside `settlement.change`, so a separate funding line
    would double-count and turn the count-once test red;
  * any UNKNOWN transaction-log type carrying nonzero `change` fails loud.
"""
from __future__ import annotations

import pytest

from datetime import datetime

from services.deribit_txn import (
    CASH_BEARING_TYPES,
    INFORMATIONAL_TYPES,
    LedgerValuationError,
    _INVERSE_CURRENCIES,
    _LINEAR_CURRENCIES,
    _NATIVE_CASH_BEARING_TYPES,
    _NATIVE_OPTIONS_SUMMARY_TYPES,
    _option_activity_after_coverage,
    _pre_coverage_option_days,
    _row_is_linear,
    _summary_coverage_windows,
    assert_balance_identity,
    classify_instrument,
    deribit_dated_external_flows_usd,
    inverse_days_needing_index,
    txn_change_to_usd,
    txn_rows_to_daily_records,
    txn_rows_to_native_daily,
)
from services.external_flows import USD_FAMILY, ExternalFlow
from tests.fixtures.deribit_flow_fixtures import (
    BTC_INDEX_2026_03_14,
    BTC_INDEX_2026_03_17,
    DAY_INVERSE_NO_INDEX,
    DAY_INVERSE_WITH_INDEX,
    DAY_LINEAR,
    DAY_PURE_FLOW,
    inverse_flow_day_with_index_rows,
    inverse_flow_day_without_index_rows,
    linear_flow_day_rows,
    pure_flow_no_trade_rows,
)


def _ms(iso: str) -> int:
    """Epoch-ms for an ISO8601 instant (Deribit txn-log carries epoch-ms)."""
    return int(datetime.fromisoformat(iso).timestamp() * 1000)


_DAY_A = "2026-01-15T12:00:00+00:00"
_DAY_B = "2026-01-16T09:30:00+00:00"


# ---------------------------------------------------------------------------
# txn_change_to_usd — inverse coin->USD at event-time index_price (D-07/D-08).
# Reads `change` (the cash-balance delta), NOT `cashflow`.
# ---------------------------------------------------------------------------


def test_inverse_short_coin_to_usd() -> None:
    """A settlement `change` on an inverse perp converts at the row's OWN
    event-time index_price, credit(+)/debit(-) sign trusted verbatim."""
    credit = {
        "type": "settlement",
        "instrument_name": "ETH-PERPETUAL",
        "currency": "ETH",
        "change": 0.05,
        "index_price": 2000.0,
        "id": 1,
    }
    assert txn_change_to_usd(credit) == pytest.approx(100.0, abs=1e-12)

    debit = {
        "type": "settlement",
        "instrument_name": "ETH-PERPETUAL",
        "currency": "ETH",
        "change": -0.031,
        "index_price": 1850.0,
        "id": 2,
    }
    # Hand-computed: -0.031 * 1850.0 == -57.35 ; a sign flip -> +57.35 (red).
    assert txn_change_to_usd(debit) == pytest.approx(-57.35, abs=1e-12)


def test_inverse_long_coin_to_usd() -> None:
    """BTC inverse perp: long-side `change` deltas convert with sign preserved."""
    a = {
        "type": "settlement",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "change": -0.02,
        "index_price": 50000.0,
        "id": 3,
    }
    assert txn_change_to_usd(a) == pytest.approx(-1000.0, abs=1e-12)

    b = {
        "type": "settlement",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "change": 0.004,
        "index_price": 61250.0,
        "id": 4,
    }
    assert txn_change_to_usd(b) == pytest.approx(245.0, abs=1e-12)


def test_change_is_string_typed_and_coerced() -> None:
    """Deribit returns numeric fields as STRINGS (incl. sci-notation). The
    conversion must coerce exactly like production float() — a str `change`
    of '-0.031' converts identically to the float form."""
    row = {
        "type": "settlement",
        "instrument_name": "ETH-PERPETUAL",
        "currency": "ETH",
        "change": "-0.031",
        "index_price": "1850.0",
        "id": 9,
    }
    assert txn_change_to_usd(row) == pytest.approx(-57.35, abs=1e-12)


def test_linear_settlement_is_usd() -> None:
    """A linear (_USDC) settlement is ALREADY USD — the index_price MUST be
    ignored. Multiplying by index (8.3) would inflate 12.5 -> 103.75 (red)."""
    row = {
        "type": "settlement",
        "instrument_name": "TRUMP_USDC-PERPETUAL",
        "currency": "USDC",
        "change": 12.5,
        "index_price": 8.3,
        "id": 5,
    }
    assert txn_change_to_usd(row) == pytest.approx(12.5, abs=1e-12)


def test_missing_event_price_fails_loud() -> None:
    """An inverse row with no event-time index_price (None or absent) AND no
    fallback MUST raise naming the row id — NEVER a current/period-end or unit
    price fallback (D-07)."""
    row_none = {
        "type": "settlement",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "change": 0.01,
        "index_price": None,
        "mark_price": None,
        "id": 987,
    }
    with pytest.raises(ValueError) as exc_none:
        txn_change_to_usd(row_none)
    assert "987" in str(exc_none.value)

    row_absent = {
        "type": "settlement",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "change": 0.01,
        "id": 654,
    }
    with pytest.raises(ValueError) as exc_absent:
        txn_change_to_usd(row_absent)
    assert "654" in str(exc_absent.value)


def test_non_positive_index_price_fails_loud() -> None:
    """A zero/negative index_price on an inverse row MUST raise — valuing coin
    cash at <=0 silently zeroes (or flips) realized cash."""
    for bad in (0.0, -1.0):
        row = {
            "type": "settlement",
            "instrument_name": "BTC-PERPETUAL",
            "currency": "BTC",
            "change": 0.01,
            "index_price": bad,
            "id": 88,
        }
        with pytest.raises(ValueError) as exc:
            txn_change_to_usd(row)
        assert "index_price" in str(exc.value)


def test_unknown_coin_currency_fails_loud_not_blind_multiplied() -> None:
    """A non-linear, non-BTC/ETH currency (e.g. a tokenized-fund wallet) has no
    basis for an index multiply — it MUST raise, never be blind-multiplied."""
    row = {
        "type": "settlement",
        "instrument_name": "BUIDL-SOMETHING",
        "currency": "BUIDL",
        "change": 5.0,
        "index_price": 1.0,
        "id": 89,
    }
    with pytest.raises(ValueError) as exc:
        txn_change_to_usd(row)
    assert "BUIDL" in str(exc.value)


def test_same_day_fallback_index_used_when_row_lacks_own() -> None:
    """A cash-bearing row structurally lacking index_price (e.g.
    negative_balance_fee: no instrument) converts via the SAME-DAY per-currency
    fallback index — not a raise. Its own index_price, when present, still wins."""
    row = {
        "type": "negative_balance_fee",
        "currency": "ETH",
        "change": -0.001,
        "id": 77,
    }
    # -0.001 * 2000 == -2.0
    assert txn_change_to_usd(row, fallback_index=2000.0) == pytest.approx(
        -2.0, abs=1e-12
    )


def test_same_day_multi_index_picks_end_of_day_deterministically() -> None:
    """MEDIUM-1 (75-05): on a day carrying MULTIPLE index-bearing rows of DIFFERENT
    index_price for the same currency, the same-day fallback index is the
    END-OF-DAY (greatest-timestamp) settlement mark — DETERMINISTIC and
    INDEPENDENT of row order. The old `setdefault` first-wins made the pick
    order-dependent (a row-order swap flipped the valued cash ~50% in the review
    repro, -40000 <-> -60000).

    Mutation-honest: reverting to `setdefault` first-wins makes the two orders
    DISAGREE (forward returns the 06:00 index, reverse the 20:00 one) and the
    end-of-day assertion fails -> RED."""
    from services.deribit_txn import _day_ccy_own_index

    day = "2026-01-15"
    early = {
        "type": "settlement", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
        "change": 0.0, "index_price": 40000.0,
        "timestamp": _ms("2026-01-15T06:00:00+00:00"), "id": 1,
    }
    late = {
        "type": "settlement", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
        "change": 0.0, "index_price": 60000.0,
        "timestamp": _ms("2026-01-15T20:00:00+00:00"), "id": 2,
    }
    key = (day, "BTC")
    fwd = _day_ccy_own_index([early, late])
    rev = _day_ccy_own_index([late, early])
    # Order-independent: both orderings agree on the SAME value.
    assert fwd[key] == rev[key]
    # The END-OF-DAY (20:00) settlement mark wins, NOT the 06:00 first-seen row.
    assert fwd[key] == pytest.approx(60000.0)

    # Observable at the valuation seam: a quiet inverse fee on the SAME day (no own
    # index) consumes this fallback, so its USD is order-independent and uses the
    # end-of-day mark. -0.1 BTC * 60000 == -6000 in BOTH orders.
    fee = {
        "type": "negative_balance_fee", "currency": "BTC", "change": -0.1,
        "timestamp": _ms("2026-01-15T23:00:00+00:00"), "id": 3,
    }
    rec_fwd = txn_rows_to_daily_records([early, late, fee])
    rec_rev = txn_rows_to_daily_records([fee, late, early])
    assert rec_fwd == rec_rev  # deterministic day-sum regardless of order
    # day-sum = 0 (settlements) + 0 (settlements) + (-0.1 * 60000) == -6000
    assert rec_fwd[0]["side"] == "sell"
    assert rec_fwd[0]["price"] == pytest.approx(6000.0, abs=1e-9)


# ---------------------------------------------------------------------------
# classify_instrument — inverse / linear / option / future / unknown
# (single definition, lifted into services.deribit_txn — D-05)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name,expected",
    [
        ("ETH-PERPETUAL", "inverse_perpetual"),
        ("BTC-PERPETUAL", "inverse_perpetual"),
        ("ETH_USDC-PERPETUAL", "linear_perpetual"),
        ("BTC_USDC-PERPETUAL", "linear_perpetual"),
        ("BTC-24JUL26-57000-P", "option"),
        ("BTC-27MAR26-60000-C", "option"),
        ("BTC-27MAR26", "future"),
        ("SOMETHING-WEIRD", "unknown"),
        ("", "unknown"),
        (None, "unknown"),
    ],
)
def test_classify_inverse_vs_linear(name: object, expected: str) -> None:
    assert classify_instrument(name) == expected  # type: ignore[arg-type]


def test_classify_never_raises_on_junk() -> None:
    # Untrusted exchange input — must classify, not crash (T-70-05 / V5).
    for junk in ("---", "12345", "BTC-", "-PERPETUAL", "BTC_USDC-"):
        assert isinstance(classify_instrument(junk), str)


# ---------------------------------------------------------------------------
# classify_instrument_settlement — the single-source coin-vs-USD decision
# shared by the ledger converter and the allocator position normalizer (P71).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name,expected",
    [
        # coin-settled (inverse): perps, dated futures, options — all BTC/ETH.
        ("BTC-PERPETUAL", (True, "BTC")),
        ("ETH-PERPETUAL", (True, "ETH")),
        ("BTC-27MAR26", (True, "BTC")),
        ("BTC-27MAR26-60000-C", (True, "BTC")),
        # linear (USD-family margin marker) → (False, "") for all kinds.
        ("BTC_USDC-PERPETUAL", (False, "")),
        ("ETH_USDT-PERPETUAL", (False, "")),
        ("BTC_USDC-27MAR26-60000-C", (False, "")),
    ],
)
def test_classify_instrument_settlement(name: str, expected: tuple) -> None:
    from services.deribit_txn import classify_instrument_settlement

    assert classify_instrument_settlement(name) == expected


def test_classify_instrument_settlement_unknown_coin_fails_loud() -> None:
    """A coin-margined instrument in an unknown currency (not BTC/ETH) must
    FAIL LOUD — never blind-multiply by a USD index (mirrors txn_change_to_usd).
    SOL on Deribit is USDC-linear, so a bare 'SOL-PERPETUAL' coin-margined
    instrument is unknown/anomalous."""
    from services.deribit_txn import classify_instrument_settlement

    with pytest.raises(ValueError, match="coin-margined"):
        classify_instrument_settlement("SOL-PERPETUAL")
    with pytest.raises(ValueError, match="empty"):
        classify_instrument_settlement("")


# ---------------------------------------------------------------------------
# Type-set partition — allow-list of return-bearing types (P70 re-probe +
# Deribit official schema); the enum is extensible so unknowns fail loud.
# ---------------------------------------------------------------------------


def test_type_sets_pinned_to_evidence() -> None:
    # Return-bearing: trade (fees), settlement (PnL+funding), delivery (expiry),
    # liquidation (forced-close), negative_balance_fee (cost of carry).
    assert CASH_BEARING_TYPES == {
        "trade",
        "settlement",
        "delivery",
        "liquidation",
        "negative_balance_fee",
    }
    # External flows / rewards unconditionally skipped — excluded from returns.
    assert INFORMATIONAL_TYPES == {
        "transfer",
        "deposit",
        "withdrawal",
        "usdc_reward",
        "swap",
    }
    # options_settlement_summary + correction are DELIBERATELY in NEITHER set
    # (H3): a nonzero-change occurrence must fail loud, not be silently skipped.
    for ambiguous in ("options_settlement_summary", "correction"):
        assert ambiguous not in CASH_BEARING_TYPES
        assert ambiguous not in INFORMATIONAL_TYPES
    # A genuinely-unknown future type is in NEITHER set (must fail loud on cash).
    for unknown in ("mystery_new_type", "rebate_v2"):
        assert unknown not in CASH_BEARING_TYPES
        assert unknown not in INFORMATIONAL_TYPES


def test_type_sets_disjoint() -> None:
    # A type in both would be simultaneously summed AND skipped — enforced at
    # import in the module, re-asserted here.
    assert CASH_BEARING_TYPES & INFORMATIONAL_TYPES == set()


# ---------------------------------------------------------------------------
# txn_rows_to_daily_records — `change`-based single sum, count-once.
# ---------------------------------------------------------------------------


def test_daily_sum_uses_change_not_cashflow_so_fees_are_not_dropped() -> None:
    """THE money-math guard. On an inverse-perp trade fill, `cashflow`=0 (session
    PnL deferred to settlement) while `change`=the fee (coin). The daily sum must
    use `change` so the fee is captured; summing `cashflow` would DROP it (0 ->
    no cash) — the BYB-02-class over-statement. Reverting the field reddens this.
    """
    trade = {
        "type": "trade",
        "instrument_name": "ETH-PERPETUAL",
        "currency": "ETH",
        "cashflow": 0.0,          # deferred session PnL — 0 at fill time
        "change": -0.002,         # the trading fee (ETH)
        "index_price": 3000.0,
        "timestamp": _ms(_DAY_A),
        "id": 61,
    }
    records = txn_rows_to_daily_records([trade])
    assert len(records) == 1
    # -0.002 * 3000 == -6.0 (fee in USD). A cashflow-only sum -> 0 -> price 0 (red).
    assert records[0]["side"] == "sell"
    assert records[0]["price"] == pytest.approx(6.0, abs=1e-9)


def test_settlement_sum_includes_funding_once() -> None:
    """A day's realized USD == the settlement `change` conversion ALONE. On
    Deribit funding is booked INSIDE settlement `change`, so re-adding a funding
    line for the same settlement (the OLD two-stream shape) would double the
    settlement cash and turn this red (count-once)."""
    settlement = {
        "type": "settlement",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "change": 0.01,  # funding-inclusive session PnL
        "index_price": 50000.0,
        "timestamp": _ms(_DAY_A),
        "id": 11,
    }
    records = txn_rows_to_daily_records([settlement])
    assert len(records) == 1
    # 0.01 * 50000 == 500.0 — the funding-inclusive settlement, summed ONCE.
    assert records[0]["price"] == pytest.approx(500.0, abs=1e-9)
    assert records[0]["side"] == "buy"
    assert records[0]["price"] == pytest.approx(
        txn_change_to_usd(settlement), abs=1e-9
    )


def test_negative_balance_fee_included_via_same_day_index() -> None:
    """negative_balance_fee is a genuine cost -> included in returns. It has no
    instrument/index_price, so its coin `change` converts via a SAME-DAY same-
    currency settlement row's index. Dropping it (informational) or failing to
    convert it would move the day-sum (red)."""
    settlement = {
        "type": "settlement",
        "instrument_name": "ETH-PERPETUAL",
        "currency": "ETH",
        "change": 0.05,          # +100 USD @2000
        "index_price": 2000.0,
        "timestamp": _ms(_DAY_A),
        "id": 71,
    }
    fee = {
        "type": "negative_balance_fee",
        "currency": "ETH",
        "change": -0.001,        # -2 USD @ same-day 2000 fallback
        "timestamp": _ms(_DAY_A),
        "id": 72,
    }
    records = txn_rows_to_daily_records([settlement, fee])
    assert len(records) == 1
    # 100.0 + (-2.0) == 98.0
    assert records[0]["side"] == "buy"
    assert records[0]["price"] == pytest.approx(98.0, abs=1e-9)


def test_coin_cash_bearing_row_with_no_index_anywhere_fails_loud() -> None:
    """A coin (inverse) cash-bearing row with no own index_price AND no same-day
    fallback in the batch MUST fail loud — never silently value the coin at 1.0."""
    fee = {
        "type": "negative_balance_fee",
        "currency": "ETH",
        "change": -0.001,
        "timestamp": _ms(_DAY_A),
        "id": 73,
    }
    with pytest.raises(ValueError) as exc:
        txn_rows_to_daily_records([fee])
    assert "73" in str(exc.value)


def test_informational_types_excluded() -> None:
    """External flows / rewards / zero-cash aggregates are NOT trading PnL — they
    are excluded from the daily return. Including any would move the day-sum off
    the settlement-only figure (red). options_settlement_summary is a zero-cash
    aggregate whose real cash is already in settlement/delivery."""
    rows = [
        {
            "type": "settlement",
            "instrument_name": "BTC-PERPETUAL",
            "currency": "BTC",
            "change": 0.01,
            "index_price": 50000.0,
            "timestamp": _ms(_DAY_A),
            "id": 21,
        },
        {"type": "transfer", "currency": "USDC", "change": 999.0,
         "timestamp": _ms(_DAY_A), "id": 22},
        {"type": "deposit", "currency": "USDC", "change": 1000.0,
         "timestamp": _ms(_DAY_A), "id": 23},
        {"type": "withdrawal", "currency": "USDC", "change": -500.0,
         "timestamp": _ms(_DAY_A), "id": 24},
        {"type": "usdc_reward", "currency": "USDC", "change": 12.0,
         "timestamp": _ms(_DAY_A), "id": 25},
        {"type": "swap", "currency": "USDC", "change": -0.5,
         "timestamp": _ms(_DAY_A), "id": 26},
        # zero-change options_settlement_summary (the normal form) is harmlessly
        # ignored via the unknown-type guard (change==0 -> no raise, not summed):
        {"type": "options_settlement_summary", "currency": "USDC", "change": 0.0,
         "timestamp": _ms(_DAY_A), "id": 28},
    ]
    records = txn_rows_to_daily_records(rows)
    assert len(records) == 1
    assert records[0]["price"] == pytest.approx(500.0, abs=1e-9)


def test_ambiguous_types_fail_loud_on_nonzero_change() -> None:
    """H3: options_settlement_summary and correction are in NEITHER set — a
    nonzero-change occurrence must FAIL LOUD (never a silent skip), forcing an
    evidence-grounded decision; their zero-change form is harmlessly ignored."""
    for t in ("options_settlement_summary", "correction"):
        nonzero = {"type": t, "currency": "USDC", "change": 12.0,
                   "timestamp": _ms(_DAY_A), "id": 91}
        with pytest.raises(ValueError) as exc:
            txn_rows_to_daily_records([nonzero])
        assert t in str(exc.value)
        zero = dict(nonzero, change=0.0)
        assert txn_rows_to_daily_records([zero]) == []


def test_cash_bearing_row_missing_change_key_fails_loud() -> None:
    """H2: a cash-bearing row with NO `change` key (schema drift / field rename)
    must raise — coalescing absent->0 would silently zero realized cash and pass
    the completeness gate green. A present `change: 0` is fine (zero cash)."""
    missing = {"type": "settlement", "instrument_name": "BTC-PERPETUAL",
               "currency": "USDC", "timestamp": _ms(_DAY_A), "id": 92}
    with pytest.raises(ValueError) as exc:
        txn_rows_to_daily_records([missing])
    assert "change" in str(exc.value)
    # A PRESENT change:0 is valid — the zero-change branch records the day at 0.
    present_zero = dict(missing, change=0.0)
    recs = txn_rows_to_daily_records([present_zero])
    assert len(recs) == 1 and recs[0]["price"] == pytest.approx(0.0)


def test_nonnumeric_change_fails_loud_as_permanent_valuation_error() -> None:
    """WR-02: a cash-bearing row whose `change` schema-drifts to a NON-NUMERIC
    value must raise ``LedgerValuationError`` (a permanent, stamped wizard gate),
    NOT a bare ``ValueError``/``TypeError`` that the worker's narrowed
    `except LedgerValuationError` lets fall through to transient → 3 retries →
    infinite 'computing' spinner (the exact class this PR kills). Revert-proof:
    unwrapping `_coerce_float` back to a bare `float(...)` makes the raise a bare
    ValueError and this `LedgerValuationError` assertion reddens.

    Both the cash-bearing path AND the unknown-type path coerce `change`; pin both.
    """
    cash = {"type": "settlement", "instrument_name": "BTC-PERPETUAL",
            "currency": "BTC", "change": "not-a-number",
            "index_price": 50000.0, "timestamp": _ms(_DAY_A), "id": 94}
    with pytest.raises(LedgerValuationError) as exc:
        txn_rows_to_daily_records([cash])
    assert "non-numeric change" in str(exc.value)

    # Unknown-type path (nonzero non-numeric change) also fails loud + permanent.
    unknown = {"type": "some_new_admin_type", "currency": "USDC",
               "change": {"unexpected": "object"}, "timestamp": _ms(_DAY_A),
               "id": 95}
    with pytest.raises(LedgerValuationError):
        txn_rows_to_daily_records([unknown])

    # And the txn_change_to_usd own-value coercions (change / index_price).
    bad_change = {"type": "settlement", "instrument_name": "BTC-PERPETUAL",
                  "currency": "BTC", "change": "x", "index_price": 50000.0,
                  "id": 96}
    with pytest.raises(LedgerValuationError):
        txn_change_to_usd(bad_change)
    bad_index = {"type": "settlement", "instrument_name": "BTC-PERPETUAL",
                 "currency": "BTC", "change": -0.01, "index_price": "oops",
                 "id": 97}
    with pytest.raises(LedgerValuationError):
        txn_change_to_usd(bad_index)


def test_liquidation_change_is_summed() -> None:
    """liquidation is CASH_BEARING — its `change` (forced-close PnL/fees) flows
    into the day-sum. Removing it from the set would drop real cash (the set-pin
    catches membership; this pins the behavior)."""
    row = {"type": "liquidation", "instrument_name": "BTC-PERPETUAL",
           "currency": "BTC", "change": -0.01, "index_price": 50000.0,
           "timestamp": _ms(_DAY_A), "id": 93}
    records = txn_rows_to_daily_records([row])
    assert len(records) == 1
    # -0.01 * 50000 == -500.0
    assert records[0]["side"] == "sell"
    assert records[0]["price"] == pytest.approx(500.0, abs=1e-9)


def test_string_epoch_ms_timestamp_is_coerced_not_crashed() -> None:
    """F5: Deribit returns numerics as strings — a digit-string epoch-ms
    timestamp must date the row, not hard-fail the whole job."""
    row = {"type": "settlement", "instrument_name": "BTC-PERPETUAL",
           "currency": "USDC", "change": 12.5, "index_price": 8.3,
           "timestamp": str(_ms(_DAY_A)), "id": 94}
    records = txn_rows_to_daily_records([row])
    assert len(records) == 1
    assert records[0]["timestamp"] == "2026-01-15T00:00:00+00:00"


def test_linear_row_does_not_poison_inverse_fallback_index() -> None:
    """M1: a linear BTC_USDC row carries currency=USDC but a BTC index_price;
    it must NOT seed a USDC (or any) fallback entry. A negative_balance_fee in
    USDC is linear (passes through), so this asserts the fallback map stays clean
    by proving a BTC fee with NO same-day BTC index-bearing row fails loud (the
    linear USDC row's BTC price never leaks in as a BTC fallback either)."""
    rows = [
        # linear row: currency USDC, but index_price is a BTC price
        {"type": "trade", "instrument_name": "BTC_USDC-PERPETUAL",
         "currency": "USDC", "change": 5.0, "index_price": 60000.0,
         "timestamp": _ms(_DAY_A), "id": 95},
        # inverse BTC fee with no own index and no BTC index-bearing row that day
        {"type": "negative_balance_fee", "currency": "BTC", "change": -0.001,
         "timestamp": _ms(_DAY_A), "id": 96},
    ]
    with pytest.raises(ValueError):
        txn_rows_to_daily_records(rows)


@pytest.mark.parametrize(
    "unknown_type",
    ["mystery_new_type", "rebate_v2", "future_type_2027"],
)
def test_unknown_change_type_fails_loud(unknown_type: str) -> None:
    """An UNKNOWN type (in neither set) carrying nonzero `change` must raise
    naming the type — silently dropping it misstates returns, and pre-parking an
    overlapping summary type would double-count (BYB-02 class). A zero-change
    unknown type is ignored with no raise (no cash to place)."""
    row = {
        "type": unknown_type,
        "instrument_name": "BTC-PERPETUAL",
        "currency": "USDC",  # USD-family: isolates the type guard from conversion
        "change": 42.0,
        "timestamp": _ms(_DAY_A),
        "id": 31,
    }
    with pytest.raises(ValueError) as exc:
        txn_rows_to_daily_records([row])
    assert unknown_type in str(exc.value)

    zero = dict(row, change=0.0)
    assert txn_rows_to_daily_records([zero]) == []


def test_option_enters_via_cash_delta_not_perp() -> None:
    """An option delivery/settlement row becomes a realized daily_pnl record via
    its `change` (converted at event-time index_price) — never through perp fill
    math. Structurally, this module imports NOTHING from services.exchange /
    ccxt / pandas, so an option can never reach perp-fill code through it."""
    option_delivery = {
        "type": "delivery",
        "instrument_name": "BTC-24JUL26-57000-P",
        "currency": "BTC",
        "change": 0.1,
        "index_price": 60000.0,
        "timestamp": _ms(_DAY_A),
        "id": 41,
    }
    records = txn_rows_to_daily_records([option_delivery])
    assert len(records) == 1
    # 0.1 * 60000 == 6000.0
    assert records[0]["price"] == pytest.approx(6000.0, abs=1e-9)
    assert records[0]["order_type"] == "daily_pnl"
    assert records[0]["side"] == "buy"

    import ast

    import services.deribit_txn as mod

    tree = ast.parse(open(mod.__file__).read())
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)
    # Pure module: no I/O / perp-fill surface reachable through it.
    for forbidden in ("services.exchange", "ccxt", "pandas", "supabase"):
        assert not any(
            name == forbidden or name.startswith(forbidden + ".")
            for name in imported
        ), f"deribit_txn must not import {forbidden}; imports={sorted(imported)}"


# ---------------------------------------------------------------------------
# P72 — quiet-day inverse rows valued via a SAME-DAY supplemental settlement
# index (public/get_delivery_prices); own/ledger index always wins (Fix B).
# ---------------------------------------------------------------------------


def test_quiet_inverse_row_without_supplemental_fails_loud() -> None:
    """PIN the P72 live finding: an inverse BTC negative_balance_fee (nonzero
    change, no index_price) on a QUIET day (no other BTC index-bearing row) has
    no own same-day fallback → txn_rows_to_daily_records raises ValueError. This
    is the exact onboarding failure Fix B repairs."""
    fee = {
        "type": "negative_balance_fee",
        "currency": "BTC",
        "change": -0.001,
        "timestamp": _ms(_DAY_A),
        "id": 301,
    }
    with pytest.raises(ValueError) as exc:
        txn_rows_to_daily_records([fee])
    assert "301" in str(exc.value)


def test_quiet_inverse_row_valued_via_supplemental_index() -> None:
    """Fix B: with a SAME-DAY supplemental settlement index, the SAME quiet BTC
    fee values at change*price and emits the right daily record.

    Revert-proof: delete the `if fb is None and supplemental_index is not None:
    fb = supplemental_index.get((day, ccy))` line in txn_rows_to_daily_records and
    this reddens (the row falls back to None → the same ValueError as above)."""
    fee = {
        "type": "negative_balance_fee",
        "currency": "BTC",
        "change": -0.001,
        "timestamp": _ms(_DAY_A),
        "id": 302,
    }
    records = txn_rows_to_daily_records(
        [fee], supplemental_index={("2026-01-15", "BTC"): 60000.0}
    )
    assert len(records) == 1
    # -0.001 * 60000 == -60.0
    assert records[0]["side"] == "sell"
    assert records[0]["price"] == pytest.approx(60.0, abs=1e-9)
    assert records[0]["timestamp"] == "2026-01-15T00:00:00+00:00"


def test_own_row_index_beats_supplemental_index() -> None:
    """Own/ledger same-day index ALWAYS wins over the supplemental settlement
    index. A day carrying BOTH an own-row BTC index (50000, via a zero-cash
    settlement that seeds the index without adding USD) AND a DIFFERENT
    supplemental price (60000) values the fee at the OWN price.

    Revert-proof: make the supplemental take precedence (e.g. consult
    supplemental_index BEFORE day_ccy_index, or set `fb = supplemental_index.get(
    (day, ccy))` unconditionally) and this reddens — the fee values at 60 not 50.
    """
    settlement = {
        "type": "settlement",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "change": 0.0,  # zero cash — seeds the OWN same-day index, adds no USD
        "index_price": 50000.0,
        "timestamp": _ms(_DAY_A),
        "id": 303,
    }
    fee = {
        "type": "negative_balance_fee",
        "currency": "BTC",
        "change": -0.001,
        "timestamp": _ms(_DAY_A),
        "id": 304,
    }
    records = txn_rows_to_daily_records(
        [settlement, fee], supplemental_index={("2026-01-15", "BTC"): 60000.0}
    )
    assert len(records) == 1
    # -0.001 * 50000 (OWN) == -50.0, NOT -0.001 * 60000 (supplemental) == -60.0.
    assert records[0]["side"] == "sell"
    assert records[0]["price"] == pytest.approx(50.0, abs=1e-9)


def test_inverse_days_needing_index_identifies_only_quiet_inverse_days() -> None:
    """inverse_days_needing_index returns EXACTLY the (day, ccy) pairs where an
    inverse cash-bearing NONZERO-change row lacks any same-day OWN index. It
    excludes: days that already have an own index, zero-change rows, and linear
    currencies. This is what the crawl consults to decide which settlement days
    to fetch."""
    _day_c = "2026-01-17T08:00:00+00:00"
    rows = [
        # (A) quiet BTC fee — no own index that day → NEEDED.
        {"type": "negative_balance_fee", "currency": "BTC", "change": -0.001,
         "timestamp": _ms(_DAY_A), "id": 401},
        # (B) BTC fee on a day that ALSO has an own BTC index → NOT needed.
        {"type": "settlement", "instrument_name": "BTC-PERPETUAL",
         "currency": "BTC", "change": 0.01, "index_price": 50000.0,
         "timestamp": _ms(_DAY_B), "id": 402},
        {"type": "negative_balance_fee", "currency": "BTC", "change": -0.002,
         "timestamp": _ms(_DAY_B), "id": 403},
        # (C) zero-change BTC fee on a quiet day → NOT needed (no cash to value).
        {"type": "negative_balance_fee", "currency": "BTC", "change": 0.0,
         "timestamp": _ms(_day_c), "id": 404},
        # (D) linear USDC cash row on a quiet day → NOT needed (already USD).
        {"type": "negative_balance_fee", "currency": "USDC", "change": -5.0,
         "timestamp": _ms(_day_c), "id": 405},
    ]
    needed = inverse_days_needing_index(rows)
    assert needed == {("2026-01-15", "BTC")}


def test_daily_record_shape_and_single_sum() -> None:
    """One daily_pnl record per UTC day; side encodes the signed day-sum, price
    is the absolute USD, timestamp is ISO8601 UTC at 00:00:00."""
    rows = [
        {
            "type": "settlement",
            "instrument_name": "BTC-PERPETUAL",
            "currency": "BTC",
            "change": 0.01,  # +500 on day A
            "index_price": 50000.0,
            "timestamp": _ms(_DAY_A),
            "id": 51,
        },
        {
            "type": "settlement",
            "instrument_name": "BTC-PERPETUAL",
            "currency": "BTC",
            "change": -0.02,  # -1000 on day B
            "index_price": 50000.0,
            "timestamp": _ms(_DAY_B),
            "id": 52,
        },
    ]
    records = txn_rows_to_daily_records(rows)
    assert len(records) == 2
    expected_keys = {
        "exchange",
        "symbol",
        "side",
        "price",
        "quantity",
        "fee",
        "fee_currency",
        "timestamp",
        "order_type",
    }
    for rec in records:
        assert set(rec.keys()) == expected_keys
        assert rec["order_type"] == "daily_pnl"

    by_day = {rec["timestamp"]: rec for rec in records}
    day_a = by_day["2026-01-15T00:00:00+00:00"]
    day_b = by_day["2026-01-16T00:00:00+00:00"]
    assert day_a["side"] == "buy"
    assert day_a["price"] == pytest.approx(500.0, abs=1e-9)
    assert day_b["side"] == "sell"
    assert day_b["price"] == pytest.approx(1000.0, abs=1e-9)


# ---------------------------------------------------------------------------
# Plan 75-02 Task 1 — deribit_dated_external_flows_usd: the ONE honest dated
# per-UTC-day ExternalFlow producer (linear pass-through + inverse valued at the
# same-day settlement index via txn_change_to_usd, fail-loud on a missing index).
# Every proof below is mutation-honest: a wrong sign / wrong-day index / 1.0 /
# dropped flow / neutered INFORMATIONAL skip turns it RED.
# ---------------------------------------------------------------------------


def test_dated_external_flow_sign_and_event_time_value() -> None:
    """Sign + date + event-time value: an inverse BTC withdrawal (change=-0.5) on
    a day whose OWN settlement row seeds the same-day BTC index (42000) emits ONE
    ExternalFlow on the row's ACTUAL UTC day with usd_signed == -0.5 * 42000 ==
    -21000 (NEGATIVE).

    Mutation-honest: flipping the change sign, using a different-day index, a 1.0
    unit price, or a current price all change the asserted -21000.0; dropping the
    flow empties the list. The index comes from the batch's OWN index-bearing
    settlement row (scenario 2), so no supplemental_index is needed."""
    flows = deribit_dated_external_flows_usd(inverse_flow_day_with_index_rows())
    assert len(flows) == 1
    flow = flows[0]
    assert flow.utc_day_iso == DAY_INVERSE_WITH_INDEX
    assert flow.usd_signed == pytest.approx(-0.5 * BTC_INDEX_2026_03_14, abs=1e-9)
    assert flow.usd_signed == pytest.approx(-21000.0, abs=1e-9)
    assert flow.usd_signed < 0.0  # a withdrawal is capital OUT


def test_flow_linear_vs_inverse_valuation() -> None:
    """A LINEAR (USDC) deposit passes through as USD with NO index multiplication
    (Pitfall 4: a USDC $50000 must not become $50000*index); an INVERSE (BTC) flow
    IS index-multiplied. Same producer, two valuation paths — both via
    txn_change_to_usd."""
    linear = deribit_dated_external_flows_usd(linear_flow_day_rows())
    assert len(linear) == 1
    assert linear[0].utc_day_iso == DAY_LINEAR
    # +50000 USDC passes through verbatim (NOT 50000 * any index).
    assert linear[0].usd_signed == pytest.approx(50000.0, abs=1e-9)

    inverse = deribit_dated_external_flows_usd(inverse_flow_day_with_index_rows())
    # -0.5 BTC IS index-multiplied (-21000), proving the inverse branch fires.
    assert inverse[0].usd_signed == pytest.approx(-21000.0, abs=1e-9)


def test_dated_external_flow_via_supplemental_index() -> None:
    """A quiet-day inverse withdrawal with NO own same-day index values via the
    supplemental (C1-fetched) settlement index — the P72 quiet-day case
    generalized to a flow row. -0.1 BTC * 41000 == -4100."""
    flows = deribit_dated_external_flows_usd(
        pure_flow_no_trade_rows(),
        supplemental_index={(DAY_PURE_FLOW, "BTC"): BTC_INDEX_2026_03_17},
    )
    assert len(flows) == 1
    assert flows[0].utc_day_iso == DAY_PURE_FLOW
    assert flows[0].usd_signed == pytest.approx(-0.1 * BTC_INDEX_2026_03_17, abs=1e-9)
    assert flows[0].usd_signed == pytest.approx(-4100.0, abs=1e-9)


def test_flow_unvaluable_fails_loud() -> None:
    """RISKY fail-loud: an inverse BTC withdrawal on a QUIET day with NO own index
    AND no supplemental entry propagates LedgerValuationError (naming the row) from
    txn_change_to_usd — NEVER a silent 0.0 / passthrough / 1.0 valuation. Providing
    a same-day index is the ONLY way to value it."""
    with pytest.raises(LedgerValuationError) as exc:
        deribit_dated_external_flows_usd(inverse_flow_day_without_index_rows())
    # the row id (75_3_001) is named in the raised error
    assert "75" in str(exc.value)
    assert "index" in str(exc.value).lower()


def test_dated_external_flow_missing_change_fails_loud() -> None:
    """W2 (RISKY discipline, option b): a flow row with NO `change` field fails
    loud BEFORE valuation rather than coalescing an absent balance-delta to 0.0
    (schema drift would silently zero a real capital flow and mis-anchor the TWR
    base). This is a flow-producer guard that does NOT touch the shared
    txn_change_to_usd coalesce (cash-bearing rows rely on it)."""
    row_no_change = {
        "type": "withdrawal",
        "currency": "BTC",
        "timestamp": _ms(_DAY_A),
        "id": 7502001,
    }
    with pytest.raises(LedgerValuationError) as exc:
        deribit_dated_external_flows_usd([row_no_change])
    assert "change" in str(exc.value)
    assert "7502001" in str(exc.value)


@pytest.mark.parametrize("blank", [None, "", "   ", "\t"])
def test_dated_external_flow_null_blank_change_fails_loud(blank: object) -> None:
    """HIGH-2 (75-05): a flow row whose `change` is PRESENT but null/blank (None,
    empty or whitespace-only string) fails loud — the absent-KEY guard does NOT
    catch it, and the old `raw_change or 0.0` coalesce would silently turn it into
    a 0.0 flow -> `continue` -> a DROPPED real capital in/out (the original LTP068
    dropped-flow class). Mutation-honest: restoring `or 0.0` makes None/"" skip
    silently (returns []) instead of raising -> RED."""
    row = {
        "type": "withdrawal",
        "currency": "USDC",  # linear: would value with no index if it got that far
        "change": blank,
        "timestamp": _ms(_DAY_A),
        "id": 7502002,
    }
    with pytest.raises(LedgerValuationError) as exc:
        deribit_dated_external_flows_usd([row])
    assert "change" in str(exc.value)
    assert "7502002" in str(exc.value)


def test_dated_external_flow_numeric_zero_change_is_legit_noop() -> None:
    """HIGH-2 boundary: a NUMERIC 0.0 `change` (observed flow row, no cash) stays a
    legitimate no-op skip — NOT a fail-loud. The null/blank guard must reject only
    None/blank, never a real zero. (Pins that the guard is not over-broad.)"""
    row = {
        "type": "withdrawal",
        "currency": "USDC",
        "change": 0.0,
        "timestamp": _ms(_DAY_A),
        "id": 7502003,
    }
    assert deribit_dated_external_flows_usd([row]) == []


@pytest.mark.parametrize("blank", [None, "", "   ", "\t"])
def test_cash_bearing_null_blank_change_fails_loud(blank: object) -> None:
    """HIGH-2 (75-05): a cash-bearing row whose `change` is PRESENT but null/blank
    fails loud — the old `raw_change or 0.0` coalesce would silently zero real
    realized cash and render a green-but-wrong track record. Mutation-honest:
    restoring `or 0.0` makes None/"" a silent zero-cash day instead of raising ->
    RED. Applied identically to the shared cash-bearing realized branch."""
    row = {
        "type": "trade",
        "instrument_name": "BTC_USDC-PERPETUAL",  # linear: USD passthrough
        "currency": "USDC",
        "change": blank,
        "timestamp": _ms(_DAY_A),
        "id": 7502004,
    }
    with pytest.raises(LedgerValuationError) as exc:
        txn_rows_to_daily_records([row])
    assert "change" in str(exc.value)
    assert "7502004" in str(exc.value)


def test_cash_bearing_numeric_zero_change_is_legit_noop() -> None:
    """HIGH-2 boundary: a NUMERIC 0.0 cash-bearing `change` stays a legitimate
    zero-cash day (the day is present at 0.0, no index needed) — NOT a fail-loud.
    Pins that the null/blank guard does not reject a real zero."""
    row = {
        "type": "trade",
        "instrument_name": "BTC_USDC-PERPETUAL",
        "currency": "USDC",
        "change": 0.0,
        "timestamp": _ms(_DAY_A),
        "id": 7502005,
    }
    records = txn_rows_to_daily_records([row])
    assert len(records) == 1
    assert records[0]["price"] == pytest.approx(0.0, abs=1e-12)


def test_flow_count_once_excluded_from_realized_sum() -> None:
    """Count-once: a flow row feeds the dated F_t list EXACTLY once and is ABSENT
    from the realized sum (txn_rows_to_daily_records skips INFORMATIONAL_TYPES).

    linear_flow_day_rows() carries a +50000 USDC deposit AND a -5.0 USDC trade fee
    on the same day. The realized sum contains ONLY the -5.0 fee; the dated flow
    list contains ONLY the +50000 deposit.

    Mutation-honest: neutering the `if row_type in INFORMATIONAL_TYPES: continue`
    skip in txn_rows_to_daily_records makes the +50000 deposit leak into the
    realized sum (price ~49995, side buy) → RED."""
    rows = linear_flow_day_rows()

    realized = txn_rows_to_daily_records(rows)
    assert len(realized) == 1
    # realized = ONLY the -5.0 trade fee, NOT (50000 - 5) — the deposit is excluded
    assert realized[0]["side"] == "sell"
    assert realized[0]["price"] == pytest.approx(5.0, abs=1e-9)

    flows = deribit_dated_external_flows_usd(rows)
    assert len(flows) == 1
    assert flows[0].usd_signed == pytest.approx(50000.0, abs=1e-9)


def test_dated_external_flow_zero_change_dropped_and_sameday_summed() -> None:
    """A zero-change flow row contributes NO entry (no spurious day); multiple
    flows on the SAME UTC day sum into ONE ExternalFlow entry."""
    zero = {"type": "deposit", "currency": "USDC", "change": 0.0,
            "timestamp": _ms(_DAY_A), "id": 7502010}
    assert deribit_dated_external_flows_usd([zero]) == []

    d1 = {"type": "deposit", "currency": "USDC", "change": 1000.0,
          "timestamp": _ms("2026-01-15T09:00:00+00:00"), "id": 7502011}
    d2 = {"type": "deposit", "currency": "USDC", "change": 2500.0,
          "timestamp": _ms("2026-01-15T18:00:00+00:00"), "id": 7502012}
    flows = deribit_dated_external_flows_usd([d1, d2])
    assert len(flows) == 1
    assert flows[0].utc_day_iso == "2026-01-15"
    assert flows[0].usd_signed == pytest.approx(3500.0, abs=1e-9)


def test_dated_external_flow_returns_sorted_externalflow_list() -> None:
    """Result-type: the return is a list[ExternalFlow] (positionally unpackable as
    (day, usd) — the core's contract), sorted ascending by UTC day."""
    later = {"type": "deposit", "currency": "USDC", "change": 100.0,
             "timestamp": _ms("2026-02-10T12:00:00+00:00"), "id": 7502020}
    earlier = {"type": "withdrawal", "currency": "USDC", "change": -40.0,
               "timestamp": _ms("2026-02-01T12:00:00+00:00"), "id": 7502021}
    flows = deribit_dated_external_flows_usd([later, earlier])
    assert [f.utc_day_iso for f in flows] == ["2026-02-01", "2026-02-10"]
    assert all(isinstance(f, ExternalFlow) for f in flows)
    # Indexed access (matches the honest core's `day_raw, usd_raw = flow[0], flow[1]`
    # after the Phase 79-01 native-channel extension); usd_signed stays the
    # authoritative legacy figure.
    day_raw, usd_raw = flows[0][0], flows[0][1]
    assert day_raw == "2026-02-01"
    assert usd_raw == pytest.approx(-40.0, abs=1e-9)
    # Phase 80-01: the producer now emits the 4-field (day, ccy)-keyed form — a
    # USDC withdrawal carries currency="USDC" and quantity=native change (the
    # raw signed USD-family amount), while usd_signed is byte-identical to the
    # pre-80-01 2-field value (for a USD-family flow quantity == usd_signed).
    assert flows[0].currency == "USDC"
    assert flows[0].quantity == pytest.approx(-40.0, abs=1e-9)


# ---------------------------------------------------------------------------
# Plan 75-02 Task 2 — Finding C1: inverse_days_needing_index must ALSO flag
# inverse EXTERNAL-FLOW quiet days so the crawl fetches their settlement index.
# Without the extension a real BTC withdrawal on a no-trade day is invisible to
# the crawl → txn_change_to_usd fails loud downstream and sinks the whole job.
# ---------------------------------------------------------------------------


def test_c1_inverse_flow_quiet_day_needs_index() -> None:
    """C1 index-fetch proof: a QUIET-day inverse BTC withdrawal (nonzero change,
    no own same-day index) has its (day, "BTC") emitted by
    inverse_days_needing_index so the crawl fetches a settlement index for it.

    Mutation-honest: reverting the C1 extension (restoring the CASH_BEARING-only
    gate) removes (day, "BTC") from the set → the withdrawal gets no fetch → it
    fails loud downstream. This assertion goes RED without the extension."""
    needed = inverse_days_needing_index(inverse_flow_day_without_index_rows())
    assert (DAY_INVERSE_NO_INDEX, "BTC") in needed


def test_c1_cash_bearing_quiet_day_still_needed_no_regression() -> None:
    """No-regression: the pre-existing CASH_BEARING quiet-day emission (a
    negative_balance_fee on a day with no own index) is STILL flagged — the C1
    extension ADDS flow coverage, it does not replace cash-bearing coverage."""
    fee = {"type": "negative_balance_fee", "currency": "BTC", "change": -0.001,
           "timestamp": _ms(_DAY_A), "id": 501}
    needed = inverse_days_needing_index([fee])
    assert ("2026-01-15", "BTC") in needed


def test_c1_inverse_flow_day_with_own_index_not_needed() -> None:
    """Own-index dedupe: an inverse flow day that ALREADY carries a same-day OWN
    index (scenario 2's paired settlement row) is NOT emitted — no redundant fetch.
    The _day_ccy_own_index check still applies to flow rows."""
    needed = inverse_days_needing_index(inverse_flow_day_with_index_rows())
    assert (DAY_INVERSE_WITH_INDEX, "BTC") not in needed


def test_c1_linear_flow_day_not_needed() -> None:
    """Linear exclusion: a linear (USDC) external-flow day is NEVER emitted — a
    USD-family flow needs no index."""
    needed = inverse_days_needing_index(linear_flow_day_rows())
    assert all(ccy != "USDC" for _day, ccy in needed)
    assert (DAY_LINEAR, "USDC") not in needed


def test_c1_zero_change_inverse_flow_not_needed() -> None:
    """Zero-change exclusion: a zero-change inverse flow row is NOT emitted (no
    cash to value → no index needed)."""
    zero = {"type": "withdrawal", "currency": "BTC", "change": 0.0,
            "timestamp": _ms(_DAY_A), "id": 502}
    assert inverse_days_needing_index([zero]) == set()


# ---------------------------------------------------------------------------
# Phase 79-01: USD_FAMILY single source of truth (SC-3, §3.2).
# ---------------------------------------------------------------------------


def test_linear_currencies_is_usd_family_alias() -> None:
    """``_LINEAR_CURRENCIES`` is the SAME object as ``external_flows.USD_FAMILY``
    (identity — an alias, not a copy that can silently drift). RED today: the two
    are distinct frozensets with different membership (no DAI)."""
    assert _LINEAR_CURRENCIES is USD_FAMILY


def test_row_is_linear_dai_currency() -> None:
    """A DAI-currency row classifies linear (USD-family pass-through, no index
    multiply) — behavior-neutral for Deribit (no DAI wallet exists there, §3.2).
    RED today: DAI is not in ``_LINEAR_CURRENCIES``."""
    assert _row_is_linear({"currency": "DAI", "change": 100.0}) is True


def test_static_disjointness_retained() -> None:
    """The import-time floor still holds: USD-family ∩ inverse == ∅ (the static
    assert now covers ``USD_FAMILY`` since ``_LINEAR_CURRENCIES`` aliases it)."""
    assert not (_LINEAR_CURRENCIES & _INVERSE_CURRENCIES)


# ---------------------------------------------------------------------------
# Plan 79-04 Task 1 — indexable_currencies injection across the 4 deribit_txn
# census consumers (§7.1/§7.2). Default = the static floor (byte-identical);
# with SOL injected the key-1 crash class dies at the function level.
# ---------------------------------------------------------------------------

_SOL_FLOOR = frozenset({"BTC", "ETH", "SOL"})


def test_constant_retained_as_static_floor() -> None:
    """The module constant is retained UNCHANGED as the static floor — the
    degraded-mode default, never the ceiling. Mutation-honest: changing the
    default set flips every default_byte_identical pin below."""
    assert _INVERSE_CURRENCIES == frozenset({"BTC", "ETH"})


def test_txn_change_to_usd_sol_refuses_by_default() -> None:
    """default_byte_identical: WITHOUT the kwarg, a SOL row still refuses loudly
    (the static floor is BTC/ETH) — every existing caller byte-identical."""
    row = {
        "type": "settlement",
        "instrument_name": "SOL-PERPETUAL",
        "currency": "SOL",
        "change": 5.0,
        "index_price": 150.0,
        "id": 91,
    }
    with pytest.raises(LedgerValuationError) as exc:
        txn_change_to_usd(row)
    assert "SOL" in str(exc.value)


def test_txn_change_to_usd_values_sol_when_injected() -> None:
    """sol_injected (a): with SOL in ``indexable_currencies`` the SAME multiply
    fires — ``change × index_price``, no new conversion path. Mutation-honest:
    testing against the module constant instead of the parameter reddens this."""
    row = {
        "type": "settlement",
        "instrument_name": "SOL-PERPETUAL",
        "currency": "SOL",
        "change": 5.0,
        "index_price": 150.0,
        "id": 91,
    }
    # 5.0 * 150.0 == 750.0
    assert txn_change_to_usd(
        row, indexable_currencies=_SOL_FLOOR
    ) == pytest.approx(750.0, abs=1e-12)


def test_txn_change_to_usd_buidl_still_refuses_when_sol_injected() -> None:
    """sol_injected (e): a genuinely un-indexable currency (BUIDL) STILL refuses
    even with SOL injected — the refusal now fires only for currencies actually
    absent from the consulted set (the silent-mis-scale class the module fights).
    Mutation-honest: letting BUIDL through flips this red."""
    row = {
        "type": "settlement",
        "instrument_name": "BUIDL-SOMETHING",
        "currency": "BUIDL",
        "change": 5.0,
        "index_price": 1.0,
        "id": 92,
    }
    with pytest.raises(LedgerValuationError) as exc:
        txn_change_to_usd(row, indexable_currencies=_SOL_FLOOR)
    assert "BUIDL" in str(exc.value)
    # The message names the ACTUAL set consulted (now includes SOL).
    assert "SOL" in str(exc.value)


def test_classify_instrument_settlement_sol_by_default_refuses() -> None:
    """default_byte_identical: SOL-PERPETUAL still raises without the kwarg."""
    from services.deribit_txn import classify_instrument_settlement

    with pytest.raises(ValueError):
        classify_instrument_settlement("SOL-PERPETUAL")


def test_classify_instrument_settlement_sol_when_injected() -> None:
    """sol_injected (b): classify_instrument_settlement('SOL-PERPETUAL') returns
    (True, 'SOL') under injection."""
    from services.deribit_txn import classify_instrument_settlement

    assert classify_instrument_settlement(
        "SOL-PERPETUAL", indexable_currencies=_SOL_FLOOR
    ) == (True, "SOL")


def test_day_ccy_own_index_seeds_sol_when_injected() -> None:
    """sol_injected (c): _day_ccy_own_index seeds a (day, 'SOL') entry from a SOL
    index-bearing row only under injection; skips it by default."""
    from services.deribit_txn import _day_ccy_own_index

    sol_row = {
        "type": "settlement",
        "instrument_name": "SOL-PERPETUAL",
        "currency": "SOL",
        "change": 0.0,
        "index_price": 150.0,
        "timestamp": _ms("2026-01-15T20:00:00+00:00"),
        "id": 1,
    }
    assert _day_ccy_own_index([sol_row]) == {}  # default: SOL skipped
    seeded = _day_ccy_own_index([sol_row], indexable_currencies=_SOL_FLOOR)
    assert seeded[("2026-01-15", "SOL")] == pytest.approx(150.0)


def test_inverse_days_needing_index_includes_sol_when_injected() -> None:
    """sol_injected (d): inverse_days_needing_index plans a quiet SOL day only
    under injection; the internal _day_ccy_own_index consults the SAME set so the
    two never diverge (the :541-545 'all three never disagree' pin)."""
    fee = {
        "type": "negative_balance_fee",
        "currency": "SOL",
        "change": -0.1,
        "timestamp": _ms("2026-01-15T23:00:00+00:00"),
        "id": 3,
    }
    assert inverse_days_needing_index([fee]) == set()  # default: SOL skipped
    needed = inverse_days_needing_index([fee], indexable_currencies=_SOL_FLOOR)
    assert ("2026-01-15", "SOL") in needed


# ---------------------------------------------------------------------------
# Phase 80-01 Task 1 — txn_rows_to_native_daily: the (day, ccy)-keyed NATIVE-unit
# sibling of txn_rows_to_daily_records. Type-partition + the three `change`
# fail-loud guards are LIFTED VERBATIM; the sum is RAW native `change` with NO
# index multiply. The module stays pandas-pure (the AST guard forbids a pandas
# import), so it returns plain data — ccy -> {utc_day_iso: native pnl} — and the
# 80-02 adapter builds the pd.Series. Every proof below is mutation-honest.
# ---------------------------------------------------------------------------


def test_txn_rows_to_native_daily_quiet_day_no_index() -> None:
    """quiet_day_no_index: a quiet-day negative_balance_fee (BTC, no instrument,
    no index_price) contributes its RAW native change to BTC's day WITHOUT any
    settlement index — the P72 index dependency is gone from native pnl.

    Mutation-honest (a): multiplying the native sum by any fake index turns the
    asserted -0.01 into -0.01*index and reddens this test."""
    fee = {
        "type": "negative_balance_fee",
        "currency": "BTC",
        "change": -0.01,
        "timestamp": _ms(_DAY_A),
        "id": 8001001,
    }
    native = txn_rows_to_native_daily([fee])
    assert list(native) == ["BTC"]
    assert native["BTC"] == {"2026-01-15": pytest.approx(-0.01, abs=1e-12)}


def test_txn_rows_to_native_daily_external_flow_types_skipped() -> None:
    """external_flow_skip: the EXTERNAL-flow INFORMATIONAL types (transfer /
    deposit / withdrawal / usdc_reward) stay skipped in the native sibling even
    carrying nonzero change — they are external capital / rewards that enter the
    F_t flow channel (never native_pnl), exactly as in the USD sibling. `swap`
    is DELIBERATELY excluded here — it is an INTERNAL rebalance and is asserted
    to enter native_pnl by the swap tests below (HIGH-1)."""
    flow_types = sorted(INFORMATIONAL_TYPES - {"swap"})
    assert flow_types == ["deposit", "transfer", "usdc_reward", "withdrawal"]
    rows = [
        {"type": t, "currency": "BTC", "change": 1.0,
         "timestamp": _ms(_DAY_A), "id": 8001100 + i}
        for i, t in enumerate(flow_types)
    ]
    assert txn_rows_to_native_daily(rows) == {}


def test_txn_rows_to_native_daily_swap_enters_native_pnl_per_leg() -> None:
    """HIGH-1: a cross-collateral `swap` (an INTERNAL FX conversion) is
    INFORMATIONAL in the USD path (net ~0 USD across its legs, rightly skipped)
    but in NATIVE per-currency space EACH leg is a REAL balance delta that must
    enter native_pnl — else the per-bucket backward roll cannot close. A
    BTC→USDC swap (−1 BTC / +60,000 USDC) yields a native_pnl entry on EACH
    leg's currency, summing its RAW native change (no index multiply).

    Mutation-honest / neuter: skipping `swap` in the native sibling (reverting it
    to a plain INFORMATIONAL skip) drops both legs → native == {} → RED."""
    rows = [
        {"type": "swap", "currency": "BTC", "change": -1.0,
         "timestamp": _ms(_DAY_A), "id": 8009001},
        {"type": "swap", "currency": "USDC", "change": 60000.0,
         "timestamp": _ms(_DAY_A), "id": 8009002},
    ]
    native = txn_rows_to_native_daily(rows)
    assert set(native) == {"BTC", "USDC"}
    assert native["BTC"] == {"2026-01-15": pytest.approx(-1.0, abs=1e-12)}
    assert native["USDC"] == {"2026-01-15": pytest.approx(60000.0, abs=1e-12)}


def test_swap_is_native_only_usd_path_and_flow_channel_unchanged() -> None:
    """HIGH-1 count-once + USD-path byte-identity: a `swap` enters ONLY the
    native sibling's native_pnl. The USD realized path
    (``txn_rows_to_daily_records``) still SKIPS it (byte-identical to pre-fix)
    AND it is NOT an external flow (``deribit_dated_external_flows_usd`` returns
    nothing for it), so it can never double-count into F_t.

    Neuter (a): reverting the native sibling makes native_pnl empty → the last
    assert reddens. Neuter (b): routing `swap` into the flow channel makes
    ``deribit_dated_external_flows_usd`` return a nonzero entry → the flow
    assert reddens."""
    rows = [
        {"type": "swap", "currency": "BTC", "change": -1.0,
         "timestamp": _ms(_DAY_A), "id": 8009101},
        {"type": "swap", "currency": "USDC", "change": 60000.0,
         "timestamp": _ms(_DAY_A), "id": 8009102},
    ]
    # USD realized path: `swap` contributes NOTHING (unchanged, still skipped).
    assert txn_rows_to_daily_records(rows) == []
    # Flow channel: `swap` is NOT an external flow → count-once by construction.
    assert deribit_dated_external_flows_usd(rows) == []
    # Native path: `swap` DOES enter native_pnl (both legs).
    native = txn_rows_to_native_daily(rows)
    assert set(native) == {"BTC", "USDC"}


def test_txn_rows_to_native_daily_unknown_type_fail_loud() -> None:
    """unknown_type_fail_loud: an unknown type carrying nonzero change raises
    LedgerValuationError naming the type (verbatim guard); a zero-change unknown
    row is harmlessly ignored (no entry)."""
    unknown = "correction"
    row = {
        "type": unknown, "currency": "BTC", "change": 0.5,
        "timestamp": _ms(_DAY_A), "id": 8001003,
    }
    with pytest.raises(LedgerValuationError) as exc:
        txn_rows_to_native_daily([row])
    assert unknown in str(exc.value)
    assert txn_rows_to_native_daily([dict(row, change=0.0)]) == {}


def test_txn_rows_to_native_daily_absent_change_fails_loud() -> None:
    """change_guards_verbatim (absent): a cash-bearing row with NO `change` key
    fails loud naming id — never coalesced to 0.0.

    Mutation-honest (b): coalescing absent change->0.0 makes this return {}
    instead of raising and reddens the test."""
    row = {
        "type": "settlement", "currency": "BTC",
        "timestamp": _ms(_DAY_A), "id": 8001004,
    }
    with pytest.raises(LedgerValuationError) as exc:
        txn_rows_to_native_daily([row])
    assert "change" in str(exc.value)
    assert "8001004" in str(exc.value)


@pytest.mark.parametrize("blank", [None, "", "   ", "\t"])
def test_txn_rows_to_native_daily_null_blank_change_fails_loud(blank: object) -> None:
    """change_guards_verbatim (null/blank): a PRESENT-but-null/blank change
    (None, empty or whitespace-only) fails loud — the `or 0.0` coalesce that a
    revert would restore is refused. A numeric 0.0 stays legit (next test)."""
    row = {
        "type": "settlement", "currency": "BTC", "change": blank,
        "timestamp": _ms(_DAY_A), "id": 8001005,
    }
    with pytest.raises(LedgerValuationError) as exc:
        txn_rows_to_native_daily([row])
    assert "change" in str(exc.value)
    assert "8001005" in str(exc.value)


def test_txn_rows_to_native_daily_numeric_zero_change_makes_no_entry() -> None:
    """change_guards_verbatim boundary: a NUMERIC 0.0 cash-bearing row is a
    legitimate no-cash no-op — NOT a fail-loud — and, unlike the USD sibling's
    setdefault(day, 0.0), creates NO entry (native pnl has no all-zero-day
    placeholder; the native core unions flow days itself)."""
    row = {
        "type": "settlement", "currency": "BTC", "change": 0.0,
        "index_price": 60000.0, "timestamp": _ms(_DAY_A), "id": 8001006,
    }
    assert txn_rows_to_native_daily([row]) == {}


def test_txn_rows_to_native_daily_multi_currency_partition() -> None:
    """multi_currency_partition: a BTC + USDC + ETH cash batch yields three
    series keyed BTC/USDC/ETH, each summing only its own currency's days — in
    NATIVE units (no index multiply).

    Mutation-honest (c): folding all currencies into one bucket collapses the
    three keys to one and reddens this test."""
    rows = [
        {"type": "settlement", "currency": "BTC", "change": -0.01,
         "index_price": 60000.0, "timestamp": _ms(_DAY_A), "id": 8001201},
        {"type": "trade", "currency": "USDC", "change": -5.0,
         "timestamp": _ms(_DAY_A), "id": 8001202},
        {"type": "settlement", "currency": "ETH", "change": 0.2,
         "index_price": 3000.0, "timestamp": _ms(_DAY_B), "id": 8001203},
    ]
    native = txn_rows_to_native_daily(rows)
    assert set(native) == {"BTC", "USDC", "ETH"}
    assert native["BTC"] == {"2026-01-15": pytest.approx(-0.01, abs=1e-12)}
    assert native["USDC"] == {"2026-01-15": pytest.approx(-5.0, abs=1e-12)}
    assert native["ETH"] == {"2026-01-16": pytest.approx(0.2, abs=1e-12)}


def test_txn_rows_to_native_daily_same_day_multi_currency_separate_and_summed() -> None:
    """Same-day BTC rows SUM into ONE (day, ccy) native entry while a same-day
    USDC row stays a SEPARATE currency bucket — the (day, ccy) keying keeps
    same-day multi-currency activity per-currency-separate."""
    rows = [
        {"type": "settlement", "currency": "BTC", "change": -0.01,
         "index_price": 60000.0, "timestamp": _ms("2026-01-15T08:00:00+00:00"),
         "id": 8001301},
        {"type": "settlement", "currency": "BTC", "change": -0.02,
         "index_price": 60000.0, "timestamp": _ms("2026-01-15T20:00:00+00:00"),
         "id": 8001302},
        {"type": "trade", "currency": "USDC", "change": 7.0,
         "timestamp": _ms("2026-01-15T10:00:00+00:00"), "id": 8001303},
    ]
    native = txn_rows_to_native_daily(rows)
    assert native["BTC"] == {"2026-01-15": pytest.approx(-0.03, abs=1e-12)}
    assert native["USDC"] == {"2026-01-15": pytest.approx(7.0, abs=1e-12)}


# ---------------------------------------------------------------------------
# Phase 80-01 Task 2 — deribit_dated_external_flows_usd emits 4-field (day, ccy)-
# keyed ExternalFlows. usd_signed stays the authoritative legacy figure (byte-
# identical per day); currency + quantity are the additive native channel. A
# same-day USDC deposit + BTC withdrawal stays TWO flows (§2.3). Mutation-honest.
# ---------------------------------------------------------------------------


def _mixed_same_day_flow_rows(day: str = "2026-04-01") -> list[dict[str, object]]:
    """A same-UTC-day USDC deposit (+1000) AND BTC withdrawal (-0.5), with a
    zero-cash BTC settlement seeding the day's OWN index (42000) so the coin
    flow values at -0.5*42000 = -21000. Old (day-only) collapse would sum to a
    single -20000 USD flow; the (day, ccy) keying keeps them SEPARATE."""
    return [
        {"type": "settlement", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": 0.0, "index_price": 42000.0,
         "timestamp": _ms(f"{day}T08:00:00+00:00"), "id": 8002001},
        {"type": "deposit", "currency": "USDC", "change": 1000.0,
         "timestamp": _ms(f"{day}T09:00:00+00:00"), "id": 8002002},
        {"type": "withdrawal", "currency": "BTC", "change": -0.5,
         "timestamp": _ms(f"{day}T15:00:00+00:00"), "id": 8002003},
    ]


def test_flow_four_field_emit_carries_currency_and_native_quantity() -> None:
    """four_field_emit: an inverse BTC withdrawal emits currency="BTC",
    quantity=native change (-0.5, signed), usd_signed=change*index (-21000).

    Mutation-honest (b): dropping quantity (leaving None) makes this coin flow
    refuse downstream (native_nav._bucket_flow_qty INDEXED branch) — pinned here
    as quantity is not None and equals the native change."""
    flows = deribit_dated_external_flows_usd(inverse_flow_day_with_index_rows())
    assert len(flows) == 1
    flow = flows[0]
    assert flow.currency == "BTC"
    assert flow.quantity is not None
    assert flow.quantity == pytest.approx(-0.5, abs=1e-12)
    assert flow.usd_signed == pytest.approx(-0.5 * BTC_INDEX_2026_03_14, abs=1e-9)
    assert flow.usd_signed == pytest.approx(-21000.0, abs=1e-9)


def test_flow_day_ccy_keyed_no_collapse_usdc_and_btc_stay_two() -> None:
    """day_ccy_keyed_no_collapse: a same-day USDC deposit AND BTC withdrawal emit
    TWO flows (one per currency), NOT one collapsed USD sum — the accumulator is
    keyed (day, ccy).

    Mutation-honest (a): reverting the key to day-only recollapses these into a
    single -20000 USD flow and reddens this test."""
    flows = deribit_dated_external_flows_usd(_mixed_same_day_flow_rows())
    assert len(flows) == 2
    by_ccy = {f.currency: f for f in flows}
    assert set(by_ccy) == {"USDC", "BTC"}
    assert by_ccy["USDC"].usd_signed == pytest.approx(1000.0, abs=1e-9)
    assert by_ccy["USDC"].quantity == pytest.approx(1000.0, abs=1e-9)
    assert by_ccy["BTC"].usd_signed == pytest.approx(-21000.0, abs=1e-9)
    assert by_ccy["BTC"].quantity == pytest.approx(-0.5, abs=1e-12)


def test_flow_same_day_same_ccy_still_folds_to_one() -> None:
    """Two same-day USDC deposits still fold into ONE USDC flow (the (day, ccy)
    key groups by currency); quantity and usd_signed both sum."""
    day = "2026-05-02"
    d1 = {"type": "deposit", "currency": "USDC", "change": 1000.0,
          "timestamp": _ms(f"{day}T09:00:00+00:00"), "id": 8002101}
    d2 = {"type": "deposit", "currency": "USDC", "change": 2500.0,
          "timestamp": _ms(f"{day}T18:00:00+00:00"), "id": 8002102}
    flows = deribit_dated_external_flows_usd([d1, d2])
    assert len(flows) == 1
    assert flows[0].currency == "USDC"
    assert flows[0].usd_signed == pytest.approx(3500.0, abs=1e-9)
    assert flows[0].quantity == pytest.approx(3500.0, abs=1e-9)


def test_flow_usd_signed_byte_identical_per_day() -> None:
    """usd_signed_byte_identical: the per-day Σ usd_signed across the new per-ccy
    flows equals the OLD per-day collapsed usd_signed (legacy USD-space consumers
    read usd_signed and must not shift). The mixed day's old sum was
    1000 + (-21000) = -20000.

    Mutation-honest (c): perturbing usd_signed (e.g. index-multiplying the linear
    leg, or dropping the coin index multiply) changes this -20000 and reddens."""
    flows = deribit_dated_external_flows_usd(_mixed_same_day_flow_rows())
    per_day: dict[str, float] = {}
    for f in flows:
        per_day[f.utc_day_iso] = per_day.get(f.utc_day_iso, 0.0) + f.usd_signed
    assert per_day == {"2026-04-01": pytest.approx(-20000.0, abs=1e-9)}


def test_flow_every_emitted_flow_passes_validate_shape() -> None:
    """validate_passes: each emitted 4-field flow passes
    external_flows.validate_flow_shape (finite usd_signed, non-empty day,
    UPPERCASE currency, finite quantity)."""
    from services.external_flows import validate_flow_shape

    flows = deribit_dated_external_flows_usd(_mixed_same_day_flow_rows())
    assert flows  # non-empty
    for f in flows:
        assert validate_flow_shape(f) is f


# ===========================================================================
# Phase 82 — options-aware native daily P&L (coverage-gated classifier +
# balance-identity guard). Every money-path test below FAILS on pre-fix code
# (which sums option `trade`/`delivery` premium `change` as P&L and ignores the
# options_settlement_summary channel) and is mutation-honest.
# ===========================================================================

# Covered-era anchors: BTC summaries bracket 2025-07-13 → window covers it.
_SUM_LO = "2025-07-12T08:00:00+00:00"  # first summary
_SUM_HI = "2025-07-14T08:00:00+00:00"  # last summary
_COVERED_DAY = "2025-07-13T10:00:00+00:00"  # inside [first−24h, last]


def _summary_row(
    ts: str, *, ccy: str = "BTC", rpl: float = 0.0, upl: float = 0.0, rid: int = 0
) -> dict[str, object]:
    """An options_settlement_summary row: change is ALWAYS 0.0; the P&L lives in
    realized_pl (session realized) + unrealized_pl (session DELTA, load-bearing)."""
    return {
        "type": "options_settlement_summary",
        "instrument_name": "BTC-14JUL25-60000-C",
        "currency": ccy,
        "change": 0.0,
        "realized_pl": rpl,
        "unrealized_pl": upl,
        "timestamp": _ms(ts),
        "id": 8200000 + rid,
    }


def _option_trade(
    ts: str,
    *,
    ccy: str = "BTC",
    change: float,
    commission: float = 0.0007,
    instrument: str = "BTC-14JUL25-60000-C",
    rid: int = 0,
) -> dict[str, object]:
    return {
        "type": "trade",
        "instrument_name": instrument,
        "currency": ccy,
        "change": change,
        "commission": commission,
        "timestamp": _ms(ts),
        "id": 8210000 + rid,
    }


def test_option_trade_premium_excluded_fee_kept_inside_coverage() -> None:
    """The 2025-07-13 regression shape: option trade rows INSIDE coverage with a
    large net premium `change` contribute ONLY `−commission` — the premium cash
    is carried by the summary channel, never counted as P&L.

    Mutation-honest: the pre-fix formula sums `change=+2.736` as native pnl (the
    +65% spike); this asserts the day is `−0.0007`, so reverting to `change`
    reddens it hard."""
    rows = [
        _summary_row(_SUM_LO, rpl=0.0, upl=0.0, rid=1),
        _summary_row(_SUM_HI, rpl=0.0, upl=0.0, rid=2),
        _option_trade(_COVERED_DAY, change=2.736, commission=0.0007, rid=1),
    ]
    native = txn_rows_to_native_daily(rows)
    assert native["BTC"] == {"2025-07-13": pytest.approx(-0.0007, abs=1e-12)}


def test_option_rows_outside_coverage_keep_change() -> None:
    """Option rows BEFORE `first_summary − 24h` (pre-rollout) keep full `change`;
    and a currency with NO summaries keeps `change` on EVERY option row."""
    # (a) pre-rollout: 2 days before the −24h lower edge.
    pre = [
        _summary_row(_SUM_LO, rid=3),
        _summary_row(_SUM_HI, rid=4),
        _option_trade("2025-07-09T10:00:00+00:00", change=2.736, rid=2),
    ]
    native = txn_rows_to_native_daily(pre)
    assert native["BTC"] == {"2025-07-09": pytest.approx(2.736, abs=1e-9)}

    # (b) no summaries for the currency at all → every option row cash-basis.
    no_win = [_option_trade(_COVERED_DAY, change=2.736, ccy="ETH", rid=3)]
    native2 = txn_rows_to_native_daily(no_win)
    assert native2["ETH"] == {"2025-07-13": pytest.approx(2.736, abs=1e-9)}


def test_coverage_window_bounds() -> None:
    """The −24h lower edge and the last-summary upper edge are both correct."""
    windows = _summary_coverage_windows(
        [_summary_row(_SUM_LO, rid=5), _summary_row(_SUM_HI, rid=6)]
    )
    start, end = windows["BTC"]
    assert start == pytest.approx(_ms(_SUM_LO) - 24 * 3600 * 1000, abs=1)
    assert end == pytest.approx(_ms(_SUM_HI), abs=1)

    # Option trade 23h before the first summary is INSIDE (−24h edge covers it).
    inside_edge = [
        _summary_row(_SUM_LO, rid=7),
        _summary_row(_SUM_HI, rid=8),
        _option_trade("2025-07-11T09:00:00+00:00", change=1.0, commission=0.002, rid=4),
    ]
    n1 = txn_rows_to_native_daily(inside_edge)
    assert n1["BTC"] == {"2025-07-11": pytest.approx(-0.002, abs=1e-12)}

    # Option trade AFTER the last summary is OUTSIDE → trailing-edge cash basis.
    after_edge = [
        _summary_row(_SUM_LO, rid=9),
        _summary_row(_SUM_HI, rid=10),
        _option_trade("2025-07-15T09:00:00+00:00", change=1.0, commission=0.002, rid=5),
    ]
    n2 = txn_rows_to_native_daily(after_edge)
    assert n2["BTC"] == {"2025-07-15": pytest.approx(1.0, abs=1e-9)}


def test_options_settlement_summary_enters_native_pnl() -> None:
    """A summary row (change=0.0, realized_pl=0.03, unrealized_pl=-0.01) adds
    +0.02 to that (day, ccy) — the NEW native-path classification of a type the
    pre-fix code left unclassified (would ignore its zero change)."""
    rows = [_summary_row(_SUM_LO, rpl=0.03, upl=-0.01, rid=11)]
    native = txn_rows_to_native_daily(rows)
    assert native["BTC"] == {"2025-07-12": pytest.approx(0.02, abs=1e-12)}


def test_summary_unrealized_pl_is_load_bearing() -> None:
    """unrealized_pl is a session DELTA and is summed WITH realized_pl. Dropping
    it breaks the balance-identity closure on a covered fixture.

    Encodes WHY it is summed: a closure fixture where Σ_inside(change+commission)
    == Σ(rpl+upl); zeroing upl in the computed total opens a residual the guard
    catches."""
    # One covered option trade: change=+1.0, commission=0.01 → fee-gross 1.01.
    # Summary carries rpl=0.6 + upl=0.41 = 1.01 → closes.
    rows = [
        _summary_row(_SUM_LO, rpl=0.6, upl=0.41, rid=12),
        _summary_row(_SUM_HI, rid=13),
        _option_trade(_COVERED_DAY, change=1.0, commission=0.01, rid=6),
    ]
    native = txn_rows_to_native_daily(rows)
    # Green: full closure passes.
    assert_balance_identity(rows, native)
    # Mutation: drop unrealized_pl from the summed total → residual 0.41 > tol.
    broken = {
        c: dict(days) for c, days in native.items()
    }
    broken["BTC"]["2025-07-12"] = 0.6  # rpl only (upl dropped)
    with pytest.raises(LedgerValuationError):
        assert_balance_identity(rows, broken)


@pytest.mark.parametrize(
    "field,bad",
    [
        ("realized_pl", None),
        ("realized_pl", ""),
        ("realized_pl", "x"),
        ("unrealized_pl", None),
        ("unrealized_pl", ""),
        ("unrealized_pl", "x"),
    ],
)
def test_summary_missing_realized_or_unrealized_fails_loud(
    field: str, bad: object
) -> None:
    """A summary row with an absent/null/non-numeric realized_pl OR unrealized_pl
    fails loud — both are REQUIRED (probe-verified present on all rows)."""
    row = _summary_row(_SUM_LO, rpl=0.03, upl=-0.01, rid=14)
    if bad is None and field in row:
        del row[field]  # absent variant
    else:
        row[field] = bad
    with pytest.raises(LedgerValuationError):
        txn_rows_to_native_daily([row])


def test_summary_nonzero_change_fails_loud() -> None:
    """A summary row's `change` is ALWAYS 0.0; a nonzero change is semantics
    drift → fail loud (never silently sum a nonzero recap change)."""
    row = _summary_row(_SUM_LO, rpl=0.03, upl=-0.01, rid=15)
    row["change"] = 0.5
    with pytest.raises(LedgerValuationError):
        txn_rows_to_native_daily([row])


def test_option_trade_missing_commission_fails_loud() -> None:
    """Inside coverage an option trade contributes `−commission`; an
    absent/null/non-numeric commission fails loud. OUTSIDE coverage the row is
    cash-basis and commission is NOT consulted (no raise)."""
    inside_bad = [
        _summary_row(_SUM_LO, rid=16),
        _summary_row(_SUM_HI, rid=17),
        {
            "type": "trade",
            "instrument_name": "BTC-14JUL25-60000-C",
            "currency": "BTC",
            "change": 2.736,
            "timestamp": _ms(_COVERED_DAY),
            "id": 8219001,
        },
    ]
    with pytest.raises(LedgerValuationError):
        txn_rows_to_native_daily(inside_bad)

    # Outside coverage: same missing-commission option row is cash-basis, no raise.
    outside_ok = [
        _summary_row(_SUM_LO, rid=18),
        _summary_row(_SUM_HI, rid=19),
        {
            "type": "trade",
            "instrument_name": "BTC-14JUL25-60000-C",
            "currency": "BTC",
            "change": 2.736,
            "timestamp": _ms("2025-07-09T10:00:00+00:00"),
            "id": 8219002,
        },
    ]
    native = txn_rows_to_native_daily(outside_ok)
    assert native["BTC"] == {"2025-07-09": pytest.approx(2.736, abs=1e-9)}


def test_option_delivery_fee_only_inside_coverage() -> None:
    """Option `delivery` INSIDE coverage contributes fee only (`−commission`) —
    the payout cash is carried by the summary's realized_pl. OUTSIDE coverage it
    keeps `change`.

    Mutation-honest: including the full `change` (the pre-fix behavior) turns the
    asserted `−0.003` into `+1.5` and reddens."""
    inside = [
        _summary_row(_SUM_LO, rid=20),
        _summary_row(_SUM_HI, rid=21),
        {
            "type": "delivery",
            "instrument_name": "BTC-14JUL25-60000-C",
            "currency": "BTC",
            "change": 1.5,
            "commission": 0.003,
            "timestamp": _ms(_COVERED_DAY),
            "id": 8219100,
        },
    ]
    native = txn_rows_to_native_daily(inside)
    assert native["BTC"] == {"2025-07-13": pytest.approx(-0.003, abs=1e-12)}

    outside = [
        _summary_row(_SUM_LO, rid=22),
        _summary_row(_SUM_HI, rid=23),
        {
            "type": "delivery",
            "instrument_name": "BTC-14JUL25-60000-C",
            "currency": "BTC",
            "change": 1.5,
            "commission": 0.003,
            "timestamp": _ms("2025-07-09T10:00:00+00:00"),
            "id": 8219101,
        },
    ]
    n2 = txn_rows_to_native_daily(outside)
    assert n2["BTC"] == {"2025-07-09": pytest.approx(1.5, abs=1e-9)}


def test_delivery_unknown_instrument_nonzero_change_fails_loud() -> None:
    """Minor (plan-check): a `delivery` row classifying `unknown` (junk/empty
    instrument) with nonzero change fails loud — a delivery always names its
    expiring instrument; silence would mis-route expiry cash. Zero-change is a
    harmless no-op."""
    bad = {
        "type": "delivery",
        "instrument_name": "",
        "currency": "BTC",
        "change": 0.9,
        "timestamp": _ms(_COVERED_DAY),
        "id": 8219200,
    }
    with pytest.raises(LedgerValuationError):
        txn_rows_to_native_daily([bad])
    # Zero-change unknown delivery: no entry, no raise.
    assert txn_rows_to_native_daily([dict(bad, change=0.0)]) == {}


def test_balance_identity_guard_raises_on_missing_midwindow_summary() -> None:
    """The ONE residual money hole: a mid-window session with option premium cash
    but NO summary carrying it → the option `−commission` drops the premium with
    nothing replacing it → computed total ≠ Σchange beyond tolerance → raise.

    Companion green case: an equivalent fixture WITH the carrying summary closes.
    """
    # BROKEN: covered option trade change=+1.0 fee 0.01 → contributes −0.01;
    # Σchange over cash-bearing = +1.0; NO summary carries the 1.01 → residual ~1.01.
    broken_rows = [
        _summary_row(_SUM_LO, rpl=0.0, upl=0.0, rid=24),
        _summary_row(_SUM_HI, rpl=0.0, upl=0.0, rid=25),
        _option_trade(_COVERED_DAY, change=1.0, commission=0.01, rid=7),
    ]
    native_broken = txn_rows_to_native_daily(broken_rows)
    with pytest.raises(LedgerValuationError):
        assert_balance_identity(broken_rows, native_broken)

    # GREEN: the summary carries rpl+upl = change+commission = 1.01 → closes.
    ok_rows = [
        _summary_row(_SUM_LO, rpl=0.6, upl=0.41, rid=26),
        _summary_row(_SUM_HI, rpl=0.0, upl=0.0, rid=27),
        _option_trade(_COVERED_DAY, change=1.0, commission=0.01, rid=8),
    ]
    native_ok = txn_rows_to_native_daily(ok_rows)
    assert_balance_identity(ok_rows, native_ok)  # no raise


def test_balance_identity_reference_set_includes_swap() -> None:
    """M2: the guard's REFERENCE row-set is `_NATIVE_CASH_BEARING_TYPES` (which
    INCLUDES `swap`), NOT the USD `CASH_BEARING_TYPES` (which omits it). Using
    the USD set false-fires by Σ(swap change) on any swap-bearing account.

    Fixture: a swap leg (−1 BTC) that enters native_pnl. With the correct set the
    guard closes (swap on both sides); with the USD set the reference misses the
    swap change and the residual is the whole −1.0 → would raise."""
    assert "swap" in _NATIVE_CASH_BEARING_TYPES
    assert "swap" not in CASH_BEARING_TYPES
    rows = [
        {"type": "swap", "currency": "BTC", "change": -1.0,
         "timestamp": _ms(_COVERED_DAY), "id": 8219300},
        {"type": "settlement", "currency": "BTC", "change": 0.05,
         "index_price": 60000.0, "timestamp": _ms(_COVERED_DAY), "id": 8219301},
    ]
    native = txn_rows_to_native_daily(rows)
    # native total BTC = -1.0 + 0.05 = -0.95; Σchange over _NATIVE_CASH_BEARING
    # (incl swap) = -0.95 → closes. (The USD-set reference would be +0.05 → resid
    # 1.0 → raise, which this asserting-no-raise catches as the wrong set.)
    assert_balance_identity(rows, native)


def test_pre_coverage_option_days_helper() -> None:
    """Returns exactly the (ccy, day) buckets with option rows OUTSIDE coverage;
    empty for fully-covered and perp-only fixtures."""
    # Pre-rollout option day + a covered option day.
    rows = [
        _summary_row(_SUM_LO, rid=28),
        _summary_row(_SUM_HI, rid=29),
        _option_trade("2025-07-09T10:00:00+00:00", change=2.0, rid=9),  # outside
        _option_trade(_COVERED_DAY, change=1.0, rid=10),  # inside
    ]
    assert _pre_coverage_option_days(rows) == [("BTC", "2025-07-09")]

    # Fully covered: only covered option rows → empty.
    covered = [
        _summary_row(_SUM_LO, rid=30),
        _summary_row(_SUM_HI, rid=31),
        _option_trade(_COVERED_DAY, change=1.0, rid=11),
    ]
    assert _pre_coverage_option_days(covered) == []

    # Perp-only: no option rows at all → empty.
    perp = [
        {"type": "settlement", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": -0.01, "index_price": 60000.0, "timestamp": _ms(_DAY_A), "id": 8219400},
    ]
    assert _pre_coverage_option_days(perp) == []


def test_future_delivery_change_unchanged() -> None:
    """A `future` delivery (real expiry cash, no summary covers it) keeps its full
    `change` — the option classification gate never touches it."""
    rows = [
        {"type": "delivery", "instrument_name": "BTC-27MAR26", "currency": "BTC",
         "change": 0.25, "timestamp": _ms(_COVERED_DAY), "id": 8219500},
    ]
    native = txn_rows_to_native_daily(rows)
    assert native["BTC"] == {"2025-07-13": pytest.approx(0.25, abs=1e-9)}


def test_perp_trade_change_unchanged() -> None:
    """A perp `trade` (inverse or linear) keeps its `change` even INSIDE a
    currency's coverage window — the option gate is classification-gated."""
    rows = [
        _summary_row(_SUM_LO, rid=32),
        _summary_row(_SUM_HI, rid=33),
        {"type": "trade", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": -0.002, "commission": 0.001, "timestamp": _ms(_COVERED_DAY),
         "id": 8219600},
    ]
    native = txn_rows_to_native_daily(rows)
    # Perp trade change kept verbatim (NOT −commission) despite being in-window.
    assert native["BTC"]["2025-07-13"] == pytest.approx(-0.002, abs=1e-12)


def test_spot_conversion_both_legs_unchanged() -> None:
    """A BTC_USDC spot conversion (classify=='unknown') keeps both legs' `change`
    (swap-analog pin) — never reclassified to option treatment."""
    rows = [
        {"type": "trade", "instrument_name": "BTC_USDC", "currency": "BTC",
         "change": -1.0, "timestamp": _ms(_COVERED_DAY), "id": 8219700},
        {"type": "trade", "instrument_name": "BTC_USDC", "currency": "USDC",
         "change": 60000.0, "timestamp": _ms(_COVERED_DAY), "id": 8219701},
    ]
    native = txn_rows_to_native_daily(rows)
    assert native["BTC"] == {"2025-07-13": pytest.approx(-1.0, abs=1e-12)}
    assert native["USDC"] == {"2025-07-13": pytest.approx(60000.0, abs=1e-9)}


def test_perp_only_ledger_byte_identical() -> None:
    """SC-4 unit pin: a perp/future/settlement/liquidation/nbf/swap/flow ledger
    (ZERO option rows) produces the EXACT dict the pre-fix formula did — the
    coverage pre-pass finds no windows and `_pre_coverage_option_days` is empty.

    Golden literals = Σ change (the OLD formula), bit-equal.
    """
    rows = [
        {"type": "settlement", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": -0.01, "index_price": 60000.0,
         "timestamp": _ms("2026-01-15T08:00:00+00:00"), "id": 8219800},
        {"type": "trade", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": -0.0002, "commission": 0.0002,
         "timestamp": _ms("2026-01-15T09:00:00+00:00"), "id": 8219801},
        {"type": "trade", "instrument_name": "BTC-27MAR26", "currency": "BTC",
         "change": 0.03, "timestamp": _ms("2026-01-15T10:00:00+00:00"), "id": 8219802},
        {"type": "delivery", "instrument_name": "BTC-27MAR26", "currency": "BTC",
         "change": 0.02, "timestamp": _ms("2026-01-16T08:00:00+00:00"), "id": 8219803},
        {"type": "liquidation", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": -0.005, "timestamp": _ms("2026-01-16T09:00:00+00:00"), "id": 8219804},
        {"type": "negative_balance_fee", "currency": "BTC", "change": -0.001,
         "timestamp": _ms("2026-01-16T10:00:00+00:00"), "id": 8219805},
        {"type": "swap", "currency": "BTC", "change": -0.5,
         "timestamp": _ms("2026-01-17T08:00:00+00:00"), "id": 8219806},
        {"type": "deposit", "currency": "BTC", "change": 2.0,
         "timestamp": _ms("2026-01-17T09:00:00+00:00"), "id": 8219807},
    ]
    native = txn_rows_to_native_daily(rows)
    # Pre-fix golden (Σ change per (day,ccy); deposit skipped; swap summed):
    assert native == {
        "BTC": {
            "2026-01-15": pytest.approx(-0.01 + -0.0002 + 0.03, abs=1e-12),
            "2026-01-16": pytest.approx(0.02 + -0.005 + -0.001, abs=1e-12),
            "2026-01-17": pytest.approx(-0.5, abs=1e-12),
        }
    }
    # Coverage pre-pass: no summaries → no windows; no pre-coverage option days.
    assert _summary_coverage_windows(rows) == {}
    assert _pre_coverage_option_days(rows) == []
    # Guard closes trivially (contributions ARE the changes).
    assert_balance_identity(rows, native)


def test_option_activity_after_coverage_detects_trailing_option_rows() -> None:
    """CR-01: `_option_activity_after_coverage` returns exactly the currencies that
    HAVE a coverage window AND carry an option trade/delivery AFTER window_end —
    the trailing-edge open-book signal (the option book closed intra-session after
    the last summary, so `options_value==0` NOW yet the strict guard would still
    false-fire)."""
    # BTC: an option delivery AFTER the last summary (2025-07-14T08:00) → trailing.
    trailing = [
        _summary_row(_SUM_LO, rid=40),
        _summary_row(_SUM_HI, rid=41),
        {"type": "delivery", "instrument_name": "BTC-14JUL25-60000-C",
         "currency": "BTC", "change": 1.5, "commission": 0.003,
         "timestamp": _ms("2025-07-15T09:00:00+00:00"), "id": 8219900},
    ]
    assert _option_activity_after_coverage(trailing) == frozenset({"BTC"})

    # A covered-only option account (all option rows inside the window) → empty.
    covered = [
        _summary_row(_SUM_LO, rid=42),
        _summary_row(_SUM_HI, rid=43),
        _option_trade(_COVERED_DAY, change=1.0, rid=20),
    ]
    assert _option_activity_after_coverage(covered) == frozenset()

    # A PERP trade after the window is NOT option activity → empty (classification
    # gated: only option trade/delivery rows count).
    perp_after = [
        _summary_row(_SUM_LO, rid=44),
        _summary_row(_SUM_HI, rid=45),
        {"type": "trade", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": -0.002, "timestamp": _ms("2025-07-15T09:00:00+00:00"),
         "id": 8219901},
    ]
    assert _option_activity_after_coverage(perp_after) == frozenset()

    # A currency with NO summary window (pre-rollout only) is NOT "after coverage"
    # (it has no window at all — that is the _pre_coverage_option_days path).
    no_window = [_option_trade(_COVERED_DAY, change=2.0, ccy="ETH", rid=21)]
    assert _option_activity_after_coverage(no_window) == frozenset()


def test_balance_identity_exempts_open_option_currency() -> None:
    """CR-01: the STRICT balance-identity guard closes ONLY for a flat-at-settlement
    book (Σunrealized_pl telescopes to a terminal open-MTM of 0 iff flat). An OPEN
    book leaves a residual = terminal open MTM → the strict guard would raise. A
    currency in `open_option_ccys` is EXEMPTED (§5 `_assert_inception_reconciled`
    is the authoritative reconciliation on the open book)."""
    # Open book: summary carries an extra +0.09 unrealized still open at crawl →
    # computed (1.09) diverges from Σchange over cash-bearing (1.0) by 0.09.
    rows = [
        _summary_row(_SUM_LO, rpl=0.6, upl=0.5, rid=46),  # 1.1, incl open unreal.
        _summary_row(_SUM_HI, rpl=0.0, upl=0.0, rid=47),
        _option_trade(_COVERED_DAY, change=1.0, commission=0.01, rid=22),  # −0.01
    ]
    native = txn_rows_to_native_daily(rows)
    # Without exemption the open-book residual breaches (this is the FLAT-only
    # closure limitation the fix targets).
    with pytest.raises(LedgerValuationError):
        assert_balance_identity(rows, native)
    # Exempting BTC skips the residual compare → no raise (§5 guards it).
    assert_balance_identity(rows, native, open_option_ccys=frozenset({"BTC"}))


def test_balance_identity_default_frozenset_is_byte_identical() -> None:
    """CR-01 byte-identity: the default `open_option_ccys=frozenset()` exempts
    NOTHING — a flat covered fixture still closes and a real mid-window hole still
    raises, exactly as before the kwarg existed."""
    # Flat covered closure (rpl+upl == change+commission) → closes with the default.
    flat = [
        _summary_row(_SUM_LO, rpl=0.6, upl=0.41, rid=48),  # 1.01
        _summary_row(_SUM_HI, rpl=0.0, upl=0.0, rid=49),
        _option_trade(_COVERED_DAY, change=1.0, commission=0.01, rid=23),
    ]
    native_flat = txn_rows_to_native_daily(flat)
    assert_balance_identity(flat, native_flat)  # default path (no exemption)
    # A real hole still raises under the default (exemption not requested).
    broken = [
        _summary_row(_SUM_LO, rpl=0.0, upl=0.0, rid=50),
        _summary_row(_SUM_HI, rpl=0.0, upl=0.0, rid=51),
        _option_trade(_COVERED_DAY, change=1.0, commission=0.01, rid=24),
    ]
    native_broken = txn_rows_to_native_daily(broken)
    with pytest.raises(LedgerValuationError):
        assert_balance_identity(broken, native_broken)
