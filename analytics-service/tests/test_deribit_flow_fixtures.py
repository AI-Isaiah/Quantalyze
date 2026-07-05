"""Shape self-test for the Phase-75 LTP068-shaped flow fixtures (Wave 0).

Pins the STRUCTURAL identity of the five shared scenario builders so a later
wave that reshapes one cannot silently break the contract every downstream test
depends on. This is a SHAPE test (row schema + scenario identity + sign/index
conventions), not the mutation-honest valuation proofs (those live in 75-02).
"""
from __future__ import annotations

import pytest

from services.deribit_txn import (
    _EXTERNAL_FLOW_TYPES,
    _INVERSE_CURRENCIES,
    _LINEAR_CURRENCIES,
    _row_utc_day,
    txn_change_to_usd,
)
from tests.fixtures.deribit_flow_fixtures import (
    BTC_INDEX_2026_03_14,
    BTC_INDEX_2026_03_16,
    BTC_INDEX_2026_03_17,
    DAY_INVERSE_NO_INDEX,
    DAY_INVERSE_WITH_INDEX,
    REFERENCE_PRIOR_NAV_USD,
    dominating_withdrawal_rows,
    inverse_flow_day_with_index_rows,
    inverse_flow_day_without_index_rows,
    linear_flow_day_rows,
    pure_flow_no_trade_rows,
)

_ALL_BUILDERS = (
    linear_flow_day_rows,
    inverse_flow_day_with_index_rows,
    inverse_flow_day_without_index_rows,
    dominating_withdrawal_rows,
    pure_flow_no_trade_rows,
)


def _flow_rows(rows: list[dict]) -> list[dict]:
    """The external-flow (deposit/withdrawal/transfer/reward) rows in a scenario."""
    return [r for r in rows if str(r.get("type", "")) in _EXTERNAL_FLOW_TYPES]


@pytest.mark.parametrize("builder", _ALL_BUILDERS)
def test_builder_returns_nonempty_schema_valid_rows(builder) -> None:
    """Every builder returns a non-empty list of rows carrying the txn-log
    schema: a ``type``, a ``currency``, a numeric ``change``, and an epoch-MS
    ``timestamp`` that dates via the shared ``_row_utc_day`` helper."""
    rows = builder()
    assert isinstance(rows, list) and rows, f"{builder.__name__} returned no rows"
    for row in rows:
        assert isinstance(row.get("type"), str) and row["type"]
        assert isinstance(row.get("currency"), str) and row["currency"]
        assert isinstance(row.get("change"), (int, float)) and not isinstance(
            row["change"], bool
        )
        ts = row.get("timestamp")
        assert isinstance(ts, int) and not isinstance(ts, bool)
        # Epoch-MS dates cleanly through the shared bucketing helper.
        assert _row_utc_day(ts)
    # Exactly one external-flow row per scenario (single flow event per day).
    assert len(_flow_rows(rows)) == 1


def test_scenario1_linear_deposit_is_usd_family() -> None:
    """Scenario 1's flow is a LINEAR (USDC) deposit — positive sign, USD-family
    currency, and it passes through ``txn_change_to_usd`` unchanged (no index)."""
    (flow,) = _flow_rows(linear_flow_day_rows())
    assert flow["type"] == "deposit"
    assert flow["currency"] in _LINEAR_CURRENCIES
    assert flow["change"] > 0  # deposit: capital IN
    assert txn_change_to_usd(flow) == pytest.approx(flow["change"], abs=1e-9)


@pytest.mark.parametrize(
    "builder",
    (
        inverse_flow_day_with_index_rows,
        inverse_flow_day_without_index_rows,
        dominating_withdrawal_rows,
        pure_flow_no_trade_rows,
    ),
)
def test_scenarios_2345_flow_is_inverse_btc_withdrawal(builder) -> None:
    """Scenarios 2/3/4/5 flow rows are INVERSE (BTC) withdrawals — negative sign,
    coin-margined currency, and (structurally) carry no own index/instrument."""
    (flow,) = _flow_rows(builder())
    assert flow["type"] == "withdrawal"
    assert flow["currency"] in _INVERSE_CURRENCIES
    assert flow["change"] < 0  # withdrawal: capital OUT
    assert "instrument_name" not in flow  # a flow has no traded instrument
    assert "index_price" not in flow  # nor its own event-time index


def test_scenario2_carries_own_same_day_btc_index() -> None:
    """Scenario 2's day carries an index-bearing BTC settlement row → an OWN
    same-day index exists at the known constant, and the withdrawal values at
    ``change * index`` via that own index (event-time proof anchor)."""
    rows = inverse_flow_day_with_index_rows()
    day = DAY_INVERSE_WITH_INDEX
    index_rows = [
        r
        for r in rows
        if r.get("index_price") is not None
        and str(r.get("currency")).upper() == "BTC"
        and _row_utc_day(r["timestamp"]) == day
    ]
    assert index_rows, "scenario 2 must carry a same-day index-bearing BTC row"
    assert index_rows[0]["index_price"] == pytest.approx(BTC_INDEX_2026_03_14)
    # The withdrawal values via that own same-day index.
    (flow,) = _flow_rows(rows)
    assert txn_change_to_usd(
        flow, fallback_index=BTC_INDEX_2026_03_14
    ) == pytest.approx(flow["change"] * BTC_INDEX_2026_03_14, abs=1e-9)


def test_scenario3_carries_no_own_same_day_index() -> None:
    """Scenario 3's quiet day carries NO index-bearing row at all — the
    Finding-C1 fail-loud precondition (no own same-day index for the currency)."""
    rows = inverse_flow_day_without_index_rows()
    assert all(r.get("index_price") is None for r in rows)
    # Every row is on the one quiet UTC day.
    assert {_row_utc_day(r["timestamp"]) for r in rows} == {DAY_INVERSE_NO_INDEX}


def test_scenario4_valued_dominates_and_scenario5_is_sub_nav() -> None:
    """Scenario 4's valued withdrawal DOMINATES the reference prior NAV (guard
    fires) while scenario 5's is strictly UNDER it (flow-neutral r_t==0)."""
    (dom,) = _flow_rows(dominating_withdrawal_rows())
    (pure,) = _flow_rows(pure_flow_no_trade_rows())
    dom_usd = txn_change_to_usd(dom, fallback_index=BTC_INDEX_2026_03_16)
    pure_usd = txn_change_to_usd(pure, fallback_index=BTC_INDEX_2026_03_17)
    assert abs(dom_usd) >= REFERENCE_PRIOR_NAV_USD  # dominates prior NAV
    assert abs(pure_usd) < REFERENCE_PRIOR_NAV_USD  # sub-NAV, non-dominating
    assert dom_usd < 0 and pure_usd < 0  # both withdrawals stay negative


def test_known_index_constants_exported_and_distinct() -> None:
    """The event-time index constants are exported and DIFFER per day so a
    cross-time (different-day) index substitution is detectable in 75-02."""
    indices = {
        BTC_INDEX_2026_03_14,
        BTC_INDEX_2026_03_16,
        BTC_INDEX_2026_03_17,
    }
    assert len(indices) == 3  # all distinct
    assert all(px > 0 for px in indices)
