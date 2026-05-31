"""Tests for the unified equity DQ channel (B22).

These pin WHY the contract matters, not just WHAT the code does:

* the ``EquityDQ`` values are the exact ``strategy_analytics.data_quality_flags``
  JSONB keys the allocator dashboard + admin health card read — a rename here
  is a silent break of those consumers, so the test asserts the literal strings;
* the ``merge_dq_flags`` rule (bool-OR / int-sum / else-replace, bool-before-int)
  is the single source the two replay engines route through — a regression that
  e.g. summed booleans would flip a drawdown-suppression flag, so the ordering
  is asserted explicitly.
"""

import dataclasses

import pytest

from services.equity.fallback import (
    EquityDQ,
    FallbackOutcome,
    merge,
    merge_dq_flags,
)


class TestEquityDQRegistry:
    def test_values_are_the_persisted_jsonb_keys(self):
        # Locks the strategy_analytics.data_quality_flags contract. If a future
        # edit renames a member's value, the dashboard/admin reader silently
        # stops finding the flag — this assertion fails first.
        assert {d.value for d in EquityDQ} == {
            "skipped_symbols",
            "unknown_perp_symbols",
            "inverse_perp_symbols",
            "ctval_drift_warnings",
            "pre_terminus_balance_unknown",
            "okx_terminus_hit",
            "anchor_partial_ticker_symbols",
            "anchor_offset_implausible",
            "anchor_replay_unreliable",
            "anchor_offset_skipped_usd",
            "sibling_check_failed",
            "mark_price_missing_symbols",
        }

    def test_member_is_str_usable_as_dict_key(self):
        # EquityDQ subclasses str so a member can be used directly as a JSONB
        # key without .value, and equals the raw string a legacy site wrote.
        flags = {EquityDQ.OKX_TERMINUS_HIT: True}
        assert flags["okx_terminus_hit"] is True
        assert EquityDQ.SKIPPED_SYMBOLS == "skipped_symbols"


class TestFallbackOutcome:
    def test_defaults_are_empty_clean_valuation(self):
        o = FallbackOutcome(value=12.5)
        assert o.value == 12.5
        assert o.dq_flags == {}
        assert o.affected_symbols == ()

    def test_is_frozen(self):
        o = FallbackOutcome(value=1.0)
        with pytest.raises(dataclasses.FrozenInstanceError):
            o.value = 2.0  # type: ignore[misc]


class TestMergeDqFlags:
    def test_booleans_or_merge(self):
        base = {"pre_terminus_balance_unknown": False}
        merge_dq_flags(base, {"pre_terminus_balance_unknown": True})
        assert base["pre_terminus_balance_unknown"] is True
        # A later False must not clear a True.
        merge_dq_flags(base, {"pre_terminus_balance_unknown": False})
        assert base["pre_terminus_balance_unknown"] is True

    def test_ints_sum(self):
        base = {"zero_entry_price_dropped": 2}
        merge_dq_flags(base, {"zero_entry_price_dropped": 3})
        assert base["zero_entry_price_dropped"] == 5

    def test_bool_checked_before_int(self):
        # bool is a subclass of int; a True must OR-merge, NOT sum to 2.
        base = {"flag": True}
        merge_dq_flags(base, {"flag": True})
        assert base["flag"] is True

    def test_else_replaces(self):
        base = {"skipped_symbols": ["AAA"]}
        merge_dq_flags(base, {"skipped_symbols": ["BBB", "CCC"]})
        assert base["skipped_symbols"] == ["BBB", "CCC"]

    def test_mutates_in_place_and_returns_same_object(self):
        base: dict = {}
        out = merge_dq_flags(base, {"a": 1})
        assert out is base

    def test_matches_legacy_merge_rule_for_type_consistent_keys(self):
        # For the type-consistent keys both engines actually emit (a key is
        # always bool / always int / always list), the canonical defensive rule
        # is identical to BOTH legacy forms it unified — position_reconstruction
        # (bool: get(k,False) or v ; int: get(k,0)+v) and analytics_runner's
        # _merge_into_top_level_flags (defensive). This is the diff-zero contract.
        base = {"b": False, "n": 1, "s": "old"}
        merge_dq_flags(base, {"b": True, "n": 4, "s": "new", "fresh": 7})
        assert base == {"b": True, "n": 5, "s": "new", "fresh": 7}

    def test_defensive_non_numeric_existing_treated_as_zero(self):
        # The defensive superset: summing an int onto a non-numeric prior must
        # NOT raise (the simpler `existing + v` would TypeError). A corrupt
        # non-numeric prior is treated as 0 — matching analytics_runner's
        # _merge_into_top_level_flags, the form this unified onto.
        base = {"n": "corrupt"}
        merge_dq_flags(base, {"n": 3})
        assert base["n"] == 3

    def test_defensive_bool_prior_in_int_branch_treated_as_zero(self):
        # bool subclasses int; a bool prior under an int counter must not be
        # summed as 1 — it is excluded by the `not isinstance(existing, bool)`
        # guard and treated as 0.
        base = {"n": True}
        merge_dq_flags(base, {"n": 3})
        assert base["n"] == 3

    def test_defensive_bool_existing_cast_in_bool_branch(self):
        # bool branch casts existing via bool(...) so a truthy non-bool prior
        # OR-merges to a real bool True rather than leaking the prior value.
        base = {"flag": 5}  # truthy non-bool prior
        merge_dq_flags(base, {"flag": False})
        assert base["flag"] is True


class TestMergeOutcomes:
    def test_values_sum_and_flags_fold(self):
        a = FallbackOutcome(2.0, {"n": 1, "b": False}, ("AAA",))
        b = FallbackOutcome(3.0, {"n": 2, "b": True}, ("BBB",))
        out = merge(a, b)
        assert out.value == 5.0
        assert out.dq_flags == {"n": 3, "b": True}

    def test_affected_symbols_union_preserves_first_seen_order_and_dedupes(self):
        a = FallbackOutcome(0.0, affected_symbols=("AAA", "BBB"))
        b = FallbackOutcome(0.0, affected_symbols=("BBB", "CCC"))
        out = merge(a, b)
        assert out.affected_symbols == ("AAA", "BBB", "CCC")

    def test_empty_merge_is_clean_zero(self):
        out = merge()
        assert out.value == 0.0
        assert out.dq_flags == {}
        assert out.affected_symbols == ()
