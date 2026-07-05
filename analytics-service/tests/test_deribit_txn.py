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
    classify_instrument,
    inverse_days_needing_index,
    txn_change_to_usd,
    txn_rows_to_daily_records,
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
