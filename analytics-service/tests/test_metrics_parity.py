"""METRICS-13: Python-side parity test.

Reads input parquet, runs ``compute_all_metrics()`` + the runner-side helpers,
and compares against expected JSON.

D-11 hybrid tolerance + cross-AI review fixes:

- Scalar keys: byte-identical after rounding to 12 sig digits, with
  **1e-12 relative epsilon fallback** (M-Grok-2) for legitimate 1-ULP
  float-to-string-to-float drift.
- Series values: 1e-9 relative epsilon, **+0 == -0 and NaN == NaN explicitly
  handled (H-C)** — never divide by zero, never produce NaN-from-NaN false
  positives.
- Missing or extra keys: FAIL (D-12 fail-loud on contract drift).

Run: ``cd analytics-service && pytest tests/test_metrics_parity.py -x``
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

from services.analytics_runner import (
    _compute_derived_trade_metrics,  # B-01 — extracted in Plan 12-05
    _compute_position_side_volume_pcts,
    _compute_trade_mix,
    _compute_volume_aggregator,
    _compute_volume_metrics,
)
from services.metrics import compute_all_metrics
from services.position_reconstruction import compute_turnover_series

FIXTURES_DIR = Path(__file__).parent / "fixtures"

# audit-2026-05-07 G.2 / P2005: top-level keys in golden_252d_expected.json
# that are fixture-metadata, not metrics output. The parity comparator MUST
# allow these as legitimate "extra" top-level keys instead of failing the
# extra-keys check.
_FIXTURE_METADATA_KEYS = {"_fixture_has_maker_taker"}


def _round_sig(x: float, sig: int = 12) -> float:
    """Round to N significant digits (D-11 scalar comparator)."""
    if x == 0 or math.isnan(x) or math.isinf(x):
        return x
    return round(x, -int(math.floor(math.log10(abs(x)))) + (sig - 1))


def _scalar_close(a: float, b: float) -> bool:
    """D-11 + M-Grok-2: scalar comparator with two-tier semantics.

    Tier 1 (D-11): exact equality after 12-sig-digit rounding.
    Tier 2 (M-Grok-2): 1e-12 relative epsilon fallback for legitimate
                       1-ULP float-to-string-to-float drift across runtimes.

    Special cases:
      NaN == NaN  → True (D-11)
      +0 == -0    → True (H-C — never divide by zero)
    """
    # Both NaN → equal
    if math.isnan(a) and math.isnan(b):
        return True
    # Either NaN, but not both → unequal
    if math.isnan(a) or math.isnan(b):
        return False
    # Both zero (any sign) → equal — H-C: do NOT divide by zero
    if a == 0.0 and b == 0.0:
        return True
    # Tier 1: exact rounded equality
    a_r, b_r = _round_sig(a), _round_sig(b)
    if a_r == b_r:
        return True
    # Tier 2 (M-Grok-2): epsilon fallback
    if a_r == 0.0 and b_r == 0.0:
        return True
    if a_r == 0.0 or b_r == 0.0:
        return abs(a - b) < 1e-12
    return abs(a_r - b_r) / max(abs(a_r), abs(b_r)) < 1e-12


def _series_close(a: float, b: float, rel_eps: float = 1e-9) -> bool:
    """H-C: series-value comparator with explicit +0 == -0 and NaN == NaN.

    Args:
      a, b: numeric values (already known to be numeric — caller filters dates).
      rel_eps: relative epsilon for non-zero pairs (D-11: 1e-9 for series).

    Returns: True if values are considered equal under the parity contract.
    """
    # Both NaN → equal (D-11)
    if math.isnan(a) and math.isnan(b):
        return True
    # Either NaN, but not both → unequal
    if math.isnan(a) or math.isnan(b):
        return False
    # Both zero (any sign) → equal — H-C: never divide by zero
    if a == 0.0 and b == 0.0:
        return True
    # One zero, the other nonzero → absolute comparison only
    if a == 0.0 or b == 0.0:
        return abs(a - b) < rel_eps
    # Standard relative-epsilon comparison
    return abs(a - b) / max(abs(a), abs(b)) < rel_eps


def _assert_scalar_equal(actual: Any, expected: Any, key_path: str) -> None:
    """D-11 scalar: routes through ``_scalar_close`` (M-Grok-2 two-tier)."""
    if expected is None:
        assert actual is None, f"{key_path}: expected None, got {actual}"
        return
    if isinstance(expected, bool):
        assert actual == expected, f"{key_path}: expected {expected}, got {actual}"
        return
    if isinstance(expected, (int, float)):
        assert isinstance(actual, (int, float)), (
            f"{key_path}: expected number, got {type(actual)}"
        )
        assert _scalar_close(float(actual), float(expected)), (
            f"{key_path}: scalar mismatch (12-sig-digit + 1e-12 epsilon fallback): "
            f"expected {expected}, got {actual}"
        )
        return
    # Strings or other primitives — exact equality
    assert actual == expected, (
        f"{key_path}: deep mismatch — expected {expected!r}, got {actual!r}"
    )


def _assert_series_equal(
    actual: list, expected: list, key_path: str, eps: float = 1e-9
) -> None:
    """D-11 + H-C series: 1e-9 relative epsilon with proper +0/-0/NaN handling."""
    assert len(actual) == len(expected), (
        f"{key_path}: series length {len(actual)} != expected {len(expected)}"
    )
    for i, (a, e) in enumerate(zip(actual, expected)):
        if isinstance(e, dict):
            # Date-keyed series record OR sub-record (e.g., {date, gross, net})
            assert isinstance(a, dict), (
                f"{key_path}[{i}]: expected dict, got {type(a)}"
            )
            for k, ev in e.items():
                kp = f"{key_path}[{i}].{k}"
                av = a.get(k)
                if isinstance(ev, (int, float)) and not isinstance(ev, bool):
                    if ev is None:
                        assert av is None, f"{kp}: expected None, got {av}"
                    elif isinstance(ev, float) and math.isnan(ev):
                        assert isinstance(av, float) and math.isnan(av), (
                            f"{kp}: expected NaN"
                        )
                    else:
                        if av is None:
                            raise AssertionError(
                                f"{kp}: expected number {ev}, got None"
                            )
                        assert _series_close(float(av), float(ev), eps), (
                            f"{kp}: series mismatch (H-C handled): "
                            f"expected {ev}, got {av}"
                        )
                else:
                    # Non-numeric (date string etc.) — exact equality
                    assert av == ev, (
                        f"{kp}: expected {ev!r}, got {av!r}"
                    )
        else:
            _assert_scalar_equal(a, e, f"{key_path}[{i}]")


def assertMetricParity(actual: dict, expected: dict, prefix: str = "") -> None:
    """D-11 + D-12 enforcement.

    - Scalar keys: ``_scalar_close`` (12-sig-digit + 1e-12 epsilon fallback)
    - Series values: ``_series_close`` (1e-9 relative epsilon, NaN==NaN, +0==-0)
    - Missing key in actual that's present in expected: fail
    - Extra key in actual not in expected: fail (forces fixture regen on metric add)
    """
    actual_keys = set(actual.keys())
    expected_keys = set(expected.keys())
    # audit-2026-05-07 G.2 / P2005: at the top level (prefix == ""), permit
    # fixture-metadata keys (e.g. _fixture_has_maker_taker) that the regen
    # script pins into the JSON for cross-process contract enforcement.
    if prefix == "":
        expected_keys -= _FIXTURE_METADATA_KEYS
    missing = expected_keys - actual_keys
    extra = actual_keys - expected_keys
    assert not missing, f"{prefix}: missing keys in actual: {sorted(missing)}"
    assert not extra, (
        f"{prefix}: extra keys in actual: {sorted(extra)} "
        "(regen golden_252d_expected.json?)"
    )

    for key in expected_keys:
        kp = f"{prefix}.{key}" if prefix else key
        a = actual[key]
        e = expected[key]
        if isinstance(e, list):
            _assert_series_equal(a, e, kp)
        elif isinstance(e, dict):
            assertMetricParity(a, e, prefix=kp)
        else:
            _assert_scalar_equal(a, e, kp)


# H-C / M-Grok-2: helper unit tests — these MUST pass independently
def test_series_close_handles_signed_zeros():
    """H-C: +0.0 == -0.0 must be treated as equal (never divide by zero)."""
    assert _series_close(0.0, -0.0) is True
    assert _series_close(-0.0, 0.0) is True


def test_series_close_handles_nan_pair():
    """H-C: NaN == NaN must be treated as equal."""
    assert _series_close(float("nan"), float("nan")) is True


def test_series_close_one_nan_one_finite():
    """H-C: NaN vs finite must be unequal."""
    assert _series_close(float("nan"), 0.5) is False
    assert _series_close(0.5, float("nan")) is False


def test_scalar_close_two_tier_fallback():
    """M-Grok-2: scalar comparator falls through to 1e-12 epsilon if exact-rounded fails."""
    # 1-ULP drift at 12 sig digits — should pass via epsilon fallback
    a = 1.234567890123
    b = 1.2345678901230001
    assert _scalar_close(a, b) is True
    # Drift larger than 1e-12 → fail
    a = 1.0
    b = 1.0001
    assert _scalar_close(a, b) is False


def test_metrics_parity_full(golden_252d_input, golden_252d_expected):
    """METRICS-13: full parity assertion against committed fixture (B-01 + H-A1 wiring)."""
    # Run the actual metrics path
    result = compute_all_metrics(
        golden_252d_input["returns"], golden_252d_input["benchmark"]
    )

    # Read full inputs from JSON companion (incl. fills, positions, time-series)
    input_json = json.loads((FIXTURES_DIR / "golden_252d_input.json").read_text())
    fills = input_json["fills"]
    trade_metrics_from_positions = input_json["trade_metrics_from_positions"]
    positions_by_date = input_json["positions_by_date"]
    prices_by_date = input_json["prices_by_date"]
    nav_by_date = input_json["nav_by_date"]

    # B-01 path (b): merge volume + position + derived
    volume_metrics = _compute_volume_metrics(fills)
    volume_aggregator = _compute_volume_aggregator(fills)
    derived = _compute_derived_trade_metrics(volume_metrics, trade_metrics_from_positions)
    # audit-2026-05-07 G.2 / P2005: prefer the pinned fixture-mode over the
    # env. If both are set they MUST agree, otherwise CI silently tests the
    # wrong bucket shape — fail loud instead.
    fixture_has_maker_taker = bool(
        golden_252d_expected.get("_fixture_has_maker_taker", False)
    )
    env_has_maker_taker = os.getenv("TRADE_MIX_HAS_MAKER_TAKER")
    if env_has_maker_taker is not None:
        expected_env = "true" if fixture_has_maker_taker else "false"
        if env_has_maker_taker != expected_env:
            raise AssertionError(
                f"TRADE_MIX_HAS_MAKER_TAKER env ({env_has_maker_taker!r}) "
                f"contradicts fixture pinned mode "
                f"(_fixture_has_maker_taker={fixture_has_maker_taker}). "
                "Regenerate the fixture with the env you want, or unset the "
                "env. (audit-2026-05-07 P2005)"
            )
    has_maker_taker = fixture_has_maker_taker
    trade_mix = _compute_trade_mix(fills, has_maker_taker=has_maker_taker)
    # KPI-17 follow-up: position-side volume pcts. Fixture has no
    # positions list so the helper returns 0/0 — preserves the prior
    # `long_volume_pct: 0.0 / short_volume_pct: 0.0` shape.
    position_side_pcts = _compute_position_side_volume_pcts(fills, [])

    merged_trade_metrics = {
        **trade_metrics_from_positions,
        **volume_metrics,
        **position_side_pcts,
        **volume_aggregator,
        **derived,
        "trade_mix": trade_mix,
    }

    metrics_json = dict(result.metrics_json)
    metrics_json["trade_metrics"] = merged_trade_metrics
    metrics_json["volume_metrics"] = volume_aggregator

    # audit-2026-05-07 G.1 / P2004: turnover_series is a runner-level
    # sibling kind populated by analytics_runner via compute_turnover_series.
    # Previously, this test contained an inline fallback that re-derived the
    # whole series if compute_all_metrics().sibling_kinds was missing the key
    # — that fallback duplicated production math, so a bug in
    # compute_turnover_series could never fail the parity assertion. We now
    # invoke the production helper directly. If a future refactor moves
    # turnover_series into compute_all_metrics, fail loud so the engineer
    # updates the harness instead of double-computing.
    sibling = dict(result.sibling_kinds)
    if "turnover_series" in sibling:
        raise AssertionError(
            "compute_all_metrics().sibling_kinds unexpectedly contains "
            "'turnover_series' — this is a runner-level sibling kind. If "
            "you intentionally moved it into compute_all_metrics, update "
            "the parity test harness to stop computing it twice. "
            "(audit-2026-05-07 P2004)"
        )
    sibling["turnover_series"] = compute_turnover_series(
        positions_by_date, prices_by_date, nav_by_date
    )
    # exposure_series: the production helper compute_exposure_metrics is
    # async and reads position_snapshots from Supabase, so it cannot be
    # invoked from this offline parity test. We project the same shape from
    # the in-memory fixture (positions_by_date × prices_by_date), matching
    # what the runner stores. This DOES re-implement the projection — a
    # known irreducible limit of the offline test; the integration tests
    # in test_equity_reconstruction_integration.py and the runner suite
    # exercise the real DB-backed helper.
    # P2004 mitigation: if compute_all_metrics ever starts emitting
    # exposure_series, fail loud so the harness gets revisited.
    if "exposure_series" in sibling:
        raise AssertionError(
            "compute_all_metrics().sibling_kinds unexpectedly contains "
            "'exposure_series' — this is a runner-level sibling kind. If "
            "you intentionally moved it into compute_all_metrics, update "
            "the parity test harness to stop computing it twice. "
            "(audit-2026-05-07 P2004)"
        )
    symbols = list(next(iter(prices_by_date.values())).keys())
    exposure_series: list[dict[str, Any]] = []
    for d in sorted(positions_by_date.keys()):
        day_p = positions_by_date[d]
        day_pr = prices_by_date[d]
        gross = sum(abs(day_p[s] * day_pr[s]) for s in symbols)
        net = sum(day_p[s] * day_pr[s] for s in symbols)
        exposure_series.append(
            {"date": d, "gross": round(gross, 6), "net": round(net, 6)}
        )
    sibling["exposure_series"] = exposure_series

    actual = {
        "metrics_json": metrics_json,
        "sibling": sibling,
    }
    assertMetricParity(actual, golden_252d_expected)
