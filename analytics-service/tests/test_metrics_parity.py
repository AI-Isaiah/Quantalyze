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

import pytest

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


def _resolve_has_maker_taker(
    fixture_expected: dict[str, Any], env_value: str | None
) -> bool:
    """audit-2026-05-07 P2005: reconcile fixture-pinned mode against env.

    The fixture's ``_fixture_has_maker_taker`` is the source of truth.
    ``TRADE_MIX_HAS_MAKER_TAKER`` env is optional — if set, it MUST agree
    with the fixture, otherwise CI silently tests the wrong bucket shape.

    Raises:
        AssertionError if the fixture is missing the key, the key has the
            wrong type, or the env contradicts the fixture.
    """
    if "_fixture_has_maker_taker" not in fixture_expected:
        raise AssertionError(
            "golden_252d_expected.json is missing top-level "
            "'_fixture_has_maker_taker' — fixture predates P2005. "
            "Regenerate via regen_golden.py so the bucket-shape mode is "
            "pinned in. (audit-2026-05-07 P2005)"
        )
    raw_fixture_mode = fixture_expected["_fixture_has_maker_taker"]
    if not isinstance(raw_fixture_mode, bool):
        raise AssertionError(
            f"_fixture_has_maker_taker must be a JSON bool, got "
            f"{type(raw_fixture_mode).__name__}={raw_fixture_mode!r}. "
            "Regenerate the fixture. (audit-2026-05-07 P2005)"
        )
    if env_value is not None:
        # Match production parsing at services/analytics_runner.py: case-
        # insensitive comparison against "true"/"false". Strict equality
        # used to reject "True"/"TRUE" as contradictions, but production
        # parses those as truthy, so the parity test would CI-fail on the
        # exact same env that production accepts.
        env_normalized = env_value.lower()
        expected_env = "true" if raw_fixture_mode else "false"
        if env_normalized != expected_env:
            raise AssertionError(
                f"TRADE_MIX_HAS_MAKER_TAKER env ({env_value!r}) "
                f"contradicts fixture pinned mode "
                f"(_fixture_has_maker_taker={raw_fixture_mode}). "
                "Regenerate the fixture with the env you want, or unset "
                "the env. (audit-2026-05-07 P2005)"
            )
    return raw_fixture_mode


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


# audit-2026-05-07 P2005: _resolve_has_maker_taker contract pins
def test_resolve_has_maker_taker_fixture_only_true():
    """No env set — fixture pin is the source of truth (True case)."""
    assert _resolve_has_maker_taker({"_fixture_has_maker_taker": True}, None) is True


def test_resolve_has_maker_taker_fixture_only_false():
    """No env set — fixture pin is the source of truth (False case)."""
    assert (
        _resolve_has_maker_taker({"_fixture_has_maker_taker": False}, None) is False
    )


def test_resolve_has_maker_taker_env_agrees():
    """Env matches fixture — agreement returns fixture mode."""
    assert (
        _resolve_has_maker_taker({"_fixture_has_maker_taker": True}, "true") is True
    )
    assert (
        _resolve_has_maker_taker({"_fixture_has_maker_taker": False}, "false")
        is False
    )


def test_resolve_has_maker_taker_env_contradicts_raises():
    """Env contradicts fixture pin — must fail loud (P2005 core defense)."""
    with pytest.raises(AssertionError, match="contradicts fixture pinned mode"):
        _resolve_has_maker_taker({"_fixture_has_maker_taker": True}, "false")
    with pytest.raises(AssertionError, match="contradicts fixture pinned mode"):
        _resolve_has_maker_taker({"_fixture_has_maker_taker": False}, "true")


def test_resolve_has_maker_taker_missing_key_raises():
    """Pre-P2005 fixture (key absent) — must refuse instead of defaulting False."""
    with pytest.raises(AssertionError, match="missing top-level"):
        _resolve_has_maker_taker({}, None)
    with pytest.raises(AssertionError, match="missing top-level"):
        _resolve_has_maker_taker({"other_key": 1}, "true")


def test_resolve_has_maker_taker_wrong_type_raises():
    """Truthy non-bool (e.g. string 'true') must NOT silently pass as True."""
    with pytest.raises(AssertionError, match="must be a JSON bool"):
        _resolve_has_maker_taker({"_fixture_has_maker_taker": "true"}, None)
    with pytest.raises(AssertionError, match="must be a JSON bool"):
        _resolve_has_maker_taker({"_fixture_has_maker_taker": 1}, None)


def test_resolve_has_maker_taker_env_case_insensitive_match():
    """Mixed-case env matches production parsing — must NOT contradict.

    Production at services/analytics_runner.py uses ``.lower() == "true"``
    so "True"/"TRUE" are truthy. The parity reconciliation must agree
    or CI will reject env values that production accepts.
    """
    assert (
        _resolve_has_maker_taker({"_fixture_has_maker_taker": True}, "True") is True
    )
    assert (
        _resolve_has_maker_taker({"_fixture_has_maker_taker": True}, "TRUE") is True
    )
    assert (
        _resolve_has_maker_taker({"_fixture_has_maker_taker": False}, "False")
        is False
    )


def test_resolve_has_maker_taker_env_garbage_still_rejected():
    """Env set to a non-truthy/non-falsy value contradicts both modes."""
    with pytest.raises(AssertionError, match="contradicts fixture pinned mode"):
        _resolve_has_maker_taker({"_fixture_has_maker_taker": False}, "1")
    with pytest.raises(AssertionError, match="contradicts fixture pinned mode"):
        _resolve_has_maker_taker({"_fixture_has_maker_taker": True}, "")
    with pytest.raises(AssertionError, match="contradicts fixture pinned mode"):
        _resolve_has_maker_taker({"_fixture_has_maker_taker": True}, "yes")


# ---------------------------------------------------------------------------
# H-0782 / H-0797: KPI-17 position-side volume attribution coverage.
#
# The full-fixture parity test (``test_metrics_parity_full``) calls
# ``_compute_position_side_volume_pcts(fills, [])`` with an EMPTY positions
# list because the committed golden fixture carries neither fill ``cost`` /
# ``timestamp`` fields nor position ``opened_at`` / ``closed_at`` windows, so
# the helper can only short-circuit to 0/0. That leaves the actual KPI-17
# timestamp-window attribution logic (the fix for the v0.16.x
# buy/sell-as-long-volume bug) STRUCTURALLY UNREACHABLE by parity.
#
# These tests drive the helper with NON-EMPTY fills + positions so long/short
# attribution is genuinely computed, and pin hand-derived numeric values. A
# regression that flips long<->short attribution, breaks the timestamp window
# match, or reverts the KPI-17 fix will fail here even though parity passes.
# ---------------------------------------------------------------------------

# A long window [Jan-01, Jan-05] and a non-overlapping short window
# [Jan-10, Jan-15]. Fills are attributed to the first window whose
# [opened, closed] interval contains the fill timestamp.
_PSV_POSITIONS = [
    {
        "opened_at": "2025-01-01T00:00:00Z",
        "closed_at": "2025-01-05T00:00:00Z",
        "side": "long",
    },
    {
        "opened_at": "2025-01-10T00:00:00Z",
        "closed_at": "2025-01-15T00:00:00Z",
        "side": "short",
    },
]


def test_position_side_volume_attribution_pinned():
    """H-0782 / H-0797: real long/short attribution, hand-computed pins.

    Long-window cost = 100 + 300 = 400. Short-window cost = 100.
    A fill outside every window (Jan-20) and a fill with no timestamp are
    BOTH excluded from ``attributed_total``.

      attributed_total = 400 + 100        = 500
      long_volume_pct  = 400 / 500        = 0.8
      short_volume_pct = 100 / 500        = 0.2
    """
    fills = [
        {"timestamp": "2025-01-02T00:00:00Z", "cost": 100.0},  # long window
        {"timestamp": "2025-01-04T00:00:00Z", "cost": 300.0},  # long window
        {"timestamp": "2025-01-12T00:00:00Z", "cost": 100.0},  # short window
        {"timestamp": "2025-01-20T00:00:00Z", "cost": 999.0},  # unattributed
        {"cost": 50.0},  # missing timestamp -> skipped
    ]
    result = _compute_position_side_volume_pcts(fills, _PSV_POSITIONS)
    assert result == {"long_volume_pct": 0.8, "short_volume_pct": 0.2}


def test_position_side_volume_long_short_flip_is_detectable():
    """H-0797: a long<->short flip must change the pinned output.

    Swapping the two windows' sides (long->short, short->long) MUST flip the
    attribution to 0.2/0.8. This proves the assertion above cannot be a
    tautology that passes regardless of which side a fill is attributed to —
    it is the regression an attacker reverting the KPI-17 fix would trip.
    """
    flipped_positions = [
        {**_PSV_POSITIONS[0], "side": "short"},
        {**_PSV_POSITIONS[1], "side": "long"},
    ]
    fills = [
        {"timestamp": "2025-01-02T00:00:00Z", "cost": 100.0},
        {"timestamp": "2025-01-04T00:00:00Z", "cost": 300.0},
        {"timestamp": "2025-01-12T00:00:00Z", "cost": 100.0},
    ]
    result = _compute_position_side_volume_pcts(fills, flipped_positions)
    # Same 400/100 split, opposite side labels.
    assert result == {"long_volume_pct": 0.2, "short_volume_pct": 0.8}


def test_position_side_volume_uses_filled_at_fallback():
    """H-0782: the helper accepts ``filled_at`` when ``timestamp`` is absent.

    All three fills land in the long window via ``filled_at`` -> 1.0/0.0.
    """
    fills = [
        {"filled_at": "2025-01-02T00:00:00Z", "cost": 200.0},
        {"filled_at": "2025-01-03T00:00:00Z", "cost": 200.0},
    ]
    result = _compute_position_side_volume_pcts(fills, _PSV_POSITIONS)
    assert result == {"long_volume_pct": 1.0, "short_volume_pct": 0.0}


def test_position_side_volume_empty_positions_short_circuits():
    """H-0782: empty positions list short-circuits to 0/0 (documented shape).

    This pins the branch the full parity test relies on, so the contract is
    explicit rather than implicit in the parity wiring.
    """
    fills = [{"timestamp": "2025-01-02T00:00:00Z", "cost": 100.0}]
    assert _compute_position_side_volume_pcts(fills, []) == {
        "long_volume_pct": 0.0,
        "short_volume_pct": 0.0,
    }
    # No fills, non-empty positions -> also 0/0.
    assert _compute_position_side_volume_pcts([], _PSV_POSITIONS) == {
        "long_volume_pct": 0.0,
        "short_volume_pct": 0.0,
    }


def test_position_side_volume_all_unattributed_returns_zero():
    """H-0782: fills that match NO window -> attributed_total 0 -> 0/0.

    Distinguishes "no attributable volume" from a genuine 0% long share.
    """
    fills = [
        {"timestamp": "2024-12-01T00:00:00Z", "cost": 500.0},  # before any window
        {"timestamp": "2025-06-01T00:00:00Z", "cost": 500.0},  # after every window
    ]
    assert _compute_position_side_volume_pcts(fills, _PSV_POSITIONS) == {
        "long_volume_pct": 0.0,
        "short_volume_pct": 0.0,
    }


# ---------------------------------------------------------------------------
# H-0796: malformed / missing-key golden-input must surface a contextual error.
# ---------------------------------------------------------------------------

# Keys the full parity test unconditionally indexes out of the input JSON.
_REQUIRED_INPUT_KEYS = (
    "fills",
    "trade_metrics_from_positions",
    "positions_by_date",
    "prices_by_date",
    "nav_by_date",
)


def _load_golden_input(text: str, source: str = "golden_252d_input.json") -> dict:
    """Parse + validate the golden-input JSON with contextual errors.

    H-0796: a raw ``json.loads`` surfaces a truncated fixture as a test
    *collection* error (or a bare ``KeyError`` with no key context downstream).
    This wrapper turns both into a clear, source-attributed AssertionError so
    a corrupted fixture reads as an actionable test failure.
    """
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AssertionError(
            f"{source} is not valid JSON (truncated or corrupted?): {exc}"
        ) from exc
    if not isinstance(parsed, dict):
        raise AssertionError(
            f"{source} must decode to a JSON object, got {type(parsed).__name__}"
        )
    missing = [k for k in _REQUIRED_INPUT_KEYS if k not in parsed]
    if missing:
        raise AssertionError(
            f"{source} is missing required input keys: {sorted(missing)} "
            "(regenerate via tests.fixtures.regen_golden)"
        )
    return parsed


def test_load_golden_input_malformed_json_raises_contextual():
    """H-0796: truncated JSON surfaces a source-attributed error, not a raw decode error."""
    with pytest.raises(AssertionError, match="is not valid JSON"):
        _load_golden_input('{"fills": [1, 2, 3')  # truncated


def test_load_golden_input_missing_key_raises_contextual():
    """H-0796: a missing required key names WHICH key is absent."""
    with pytest.raises(AssertionError, match="missing required input keys"):
        _load_golden_input(json.dumps({"fills": []}))
    # The message must name the specific missing keys.
    try:
        _load_golden_input(json.dumps({"fills": [], "prices_by_date": {}}))
    except AssertionError as exc:
        msg = str(exc)
        assert "trade_metrics_from_positions" in msg
        assert "nav_by_date" in msg
        assert "fills" not in msg.split(":", 1)[1]  # present key not flagged
    else:  # pragma: no cover - defensive
        raise AssertionError("expected missing-key AssertionError")


def test_load_golden_input_non_object_raises_contextual():
    """H-0796: a top-level JSON array (wrong shape) is rejected with context."""
    with pytest.raises(AssertionError, match="must decode to a JSON object"):
        _load_golden_input("[1, 2, 3]")


def test_load_golden_input_accepts_real_fixture():
    """H-0796: the committed fixture passes the validator unchanged."""
    text = (FIXTURES_DIR / "golden_252d_input.json").read_text()
    parsed = _load_golden_input(text)
    for key in _REQUIRED_INPUT_KEYS:
        assert key in parsed


# ---------------------------------------------------------------------------
# H-0790: integer count metrics map to Postgres INTEGER columns. A producer
# that returns 5.0 instead of 5 would be silently coerced by the relative
# scalar comparator (``float(5) == float(5.0)``) yet rejected at JSONB write
# time. This pins type fidelity for the count keys directly off the golden.
# Tightening the global ``_assert_scalar_equal`` to ``type(expected) is
# type(actual)`` was NOT done: the parity comparator legitimately compares
# int-typed fixture counts against runtime values that may surface as float
# on other metric paths, and the instruction is to add targeted coverage
# rather than risk the golden. (See report flag.)
# ---------------------------------------------------------------------------

_INTEGER_COUNT_KEYS = (
    "winners_count",
    "losers_count",
    "total_positions",
    "long_count",
    "short_count",
    "closed_positions",
    "open_positions",
    "total_fills",
)


def test_count_metrics_are_integers_not_floats(golden_252d_expected):
    """H-0790: count metrics must be true ints in the golden (no 5.0-for-5)."""
    tm = golden_252d_expected["metrics_json"]["trade_metrics"]
    checked = 0
    for key in _INTEGER_COUNT_KEYS:
        if key not in tm:
            continue
        checked += 1
        value = tm[key]
        # bool is a subclass of int — reject it explicitly so a stray True/False
        # cannot masquerade as an integer count.
        assert not isinstance(value, bool), f"{key} is a bool, expected int"
        assert isinstance(value, int), (
            f"{key} must be a JSON integer (maps to a Postgres INTEGER column), "
            f"got {type(value).__name__}={value!r} — a float here would pass the "
            "relative scalar comparator but be rejected at JSONB write time"
        )
    assert checked >= 5, (
        "expected to find at least 5 integer count keys in the golden "
        f"trade_metrics; only matched {checked} — has the contract drifted?"
    )


# ---------------------------------------------------------------------------
# H-0784 / H-0793 / H-0795: the scalar comparator has three regimes selected by
# branching on exact-zero (both-zero -> equal; one-zero -> absolute < 1e-12;
# else relative < 1e-12). The audit worry is that a side rounding to zero masks
# a real small-value regression.
#
# These tests pin the ACTUAL behavior at meaningful magnitudes: a regression
# that drives r_squared / cagr from a small-but-real value to 0.0 IS caught,
# because the one-zero branch is an *absolute* 1e-12 comparison. The comparator
# only equates magnitudes below ~1e-12, which is the float-to-string-to-float
# noise floor the comparator exists to absorb. Tightening it further would
# reject legitimate 1-ULP cross-runtime drift, so the comparator is left as-is
# and the safety property is locked in by assertion instead. (See report.)
# ---------------------------------------------------------------------------


def test_scalar_close_catches_small_value_collapse_to_zero():
    """H-0795: r_squared 0.0001 -> 0.0 is a real regression and MUST fail."""
    assert _scalar_close(0.0001, 0.0) is False
    assert _scalar_close(0.0, 0.0001) is False


def test_scalar_close_catches_small_relative_regression():
    """H-0793: a 1% relative drift on a small value is caught."""
    # 0.0001 vs 0.000099 -> 1% relative drift, both nonzero -> relative branch.
    assert _scalar_close(0.0001, 0.000099) is False


def test_scalar_close_both_zero_is_equal_documented():
    """H-0784: both-exactly-zero short-circuits to equal (documented contract)."""
    assert _scalar_close(0.0, 0.0) is True
    assert _scalar_close(0.0, -0.0) is True


def test_scalar_close_noise_floor_is_below_1e_12():
    """H-0795: the masking regime is confined below the 1e-12 noise floor.

    Values whose absolute difference is < 1e-12 compare equal (intended:
    float-to-string-to-float drift). This pins where the absolute floor sits so
    a future widening of that floor (which WOULD mask real regressions) trips
    this test.
    """
    # Below floor -> equal (one side rounds to zero).
    assert _scalar_close(1e-13, 0.0) is True
    # At/above a meaningful magnitude -> not equal.
    assert _scalar_close(1e-9, 0.0) is False


def test_series_close_catches_small_value_collapse_to_zero():
    """H-0784 (series): a real value collapsing to 0.0 in a series is caught."""
    # one-zero branch uses absolute < rel_eps (1e-9); 0.5 vs 0.0 -> fail.
    assert _series_close(0.5, 0.0) is False
    # A value above the 1e-9 series floor vs zero is caught.
    assert _series_close(1e-6, 0.0) is False


# ---------------------------------------------------------------------------
# H-0788 (positive-output floor): guard against an all-zero / all-NaN series
# regression that would survive both regen and parity (both-zero / NaN==NaN
# short-circuits make every pair "equal"). A floor on the count of finite,
# nonzero values proves the production series actually carries signal.
# ---------------------------------------------------------------------------


def _count_finite_nonzero(values: list[float]) -> int:
    return sum(
        1
        for v in values
        if isinstance(v, (int, float))
        and not isinstance(v, bool)
        and not math.isnan(float(v))
        and float(v) != 0.0
    )


def test_turnover_series_has_nonzero_signal_floor():
    """H-0788: turnover_series must carry real signal, not collapse to all-zero.

    If a turnover regression yields [0, 0, ...], regen bakes zeros into the
    golden and ``_series_close`` short-circuits every both-zero pair to equal,
    so parity passes on a dead series. A floor on finite-nonzero turnover
    values catches that class of silent regression.
    """
    # The position/price/nav series live only in the JSON companion, not the
    # parquet-backed ``golden_252d_input`` fixture. Reuse the validated loader.
    input_json = _load_golden_input(
        (FIXTURES_DIR / "golden_252d_input.json").read_text()
    )
    series = compute_turnover_series(
        input_json["positions_by_date"],
        input_json["prices_by_date"],
        input_json["nav_by_date"],
    )
    turnover_vals = [
        rec["turnover"]
        for rec in series
        if isinstance(rec, dict) and "turnover" in rec
    ]
    assert turnover_vals, "turnover_series produced no turnover values"
    nonzero = _count_finite_nonzero(turnover_vals)
    assert nonzero >= 30, (
        f"turnover_series has only {nonzero} finite-nonzero values of "
        f"{len(turnover_vals)} — a near-dead series would silently pass parity "
        "via the both-zero short-circuit (H-0788)"
    )


# ---------------------------------------------------------------------------
# H-0791: per-key unit contract. The recursive comparator routes purely on
# Python type, so a producer that flips a unit (ratio<->percent, days<->hours)
# while regen drifts in lockstep would pass parity. There is no production
# units.yaml / TypedDict to consume, so we encode the expected unit semantics
# here as a documented, enforced contract: the golden values must fall in the
# range the declared unit implies. (A full producer-side unit annotation is a
# production change — flagged in the report.)
# ---------------------------------------------------------------------------

# (key, unit, validator) — validator returns True iff the golden value is
# consistent with the declared unit. None values are skipped (rendered as "—").
_UNIT_CONTRACT = {
    # Fractions in [0, 1]: a flip to percent (e.g. 60.0) breaks the bound.
    "win_rate": ("fraction[0,1]", lambda v: 0.0 <= v <= 1.0),
    "long_volume_pct": ("fraction[0,1]", lambda v: 0.0 <= v <= 1.0),
    "short_volume_pct": ("fraction[0,1]", lambda v: 0.0 <= v <= 1.0),
    "buy_volume_pct": ("fraction[0,1]", lambda v: 0.0 <= v <= 1.0),
    "sell_volume_pct": ("fraction[0,1]", lambda v: 0.0 <= v <= 1.0),
    # Ratios: non-negative, and not a runaway percent (a ratio expressed as a
    # percent, e.g. 250.0 for 2.5, would blow past this sane upper bound).
    "risk_reward_ratio": ("ratio>=0", lambda v: 0.0 <= v < 100.0),
    "weighted_risk_reward_ratio": ("ratio>=0", lambda v: 0.0 <= v < 100.0),
    "profit_factor": ("ratio>=0", lambda v: v >= 0.0),
}


def test_metric_unit_contract_holds_in_golden(golden_252d_expected):
    """H-0791: golden metric values must respect their declared unit semantics.

    Documents and enforces per-key units the type-routed comparator cannot
    see. A producer that flips ``win_rate`` to percent (60.0) or expresses a
    ratio as a percentage trips the relevant range check here even though the
    parity comparator (regen + runtime drifting together) would not.
    """
    tm = golden_252d_expected["metrics_json"]["trade_metrics"]
    checked = 0
    for key, (unit, ok) in _UNIT_CONTRACT.items():
        if key not in tm:
            continue
        value = tm[key]
        if value is None:
            continue
        assert isinstance(value, (int, float)) and not isinstance(value, bool), (
            f"{key}: expected numeric for unit {unit}, got {type(value).__name__}"
        )
        assert ok(float(value)), (
            f"{key}={value!r} violates declared unit contract '{unit}' — a "
            "unit flip (e.g. fraction<->percent, ratio-as-percent) would pass "
            "the type-routed parity comparator but is caught here (H-0791)"
        )
        checked += 1
    assert checked >= 3, (
        "unit contract matched fewer than 3 keys in the golden trade_metrics; "
        f"only matched {checked} — verify the metric keys still exist"
    )


def test_metric_unit_contract_rejects_percent_flip():
    """H-0791: the contract validators actually reject a unit flip.

    Proves the range checks aren't vacuous: a win_rate expressed as a percent
    (60.0) and a ratio expressed as a percent (250.0) both fail their checks.
    """
    win_rate_ok = _UNIT_CONTRACT["win_rate"][1]
    rr_ok = _UNIT_CONTRACT["risk_reward_ratio"][1]
    assert win_rate_ok(0.6) is True
    assert win_rate_ok(60.0) is False  # percent flip
    assert rr_ok(2.5) is True
    assert rr_ok(250.0) is False  # ratio-as-percent flip


def test_metrics_parity_full(golden_252d_input, golden_252d_expected):
    """METRICS-13: full parity assertion against committed fixture (B-01 + H-A1 wiring)."""
    # Run the actual metrics path
    result = compute_all_metrics(
        golden_252d_input["returns"], golden_252d_input["benchmark"]
    )

    # Read full inputs from JSON companion (incl. fills, positions, time-series).
    # H-0796: validate up front so a truncated/missing-key fixture surfaces a
    # contextual AssertionError instead of a bare decode/KeyError.
    input_json = _load_golden_input(
        (FIXTURES_DIR / "golden_252d_input.json").read_text()
    )
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
    # env. The reconciliation is extracted so it can be unit-tested
    # independently of the full parity pipeline.
    has_maker_taker = _resolve_has_maker_taker(
        golden_252d_expected, os.getenv("TRADE_MIX_HAS_MAKER_TAKER")
    )
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


# ---------------------------------------------------------------------------
# H-0753 — fixture schema validation for golden_252d_expected.json.
#
# conftest.golden_252d_expected does a bare `json.loads(...read_text())` with
# NO schema check. A contributor who commits a truncated / syntactically-valid-
# but-semantically-wrong fixture (e.g. `{}`, or one missing the `sibling` key)
# would surface a confusing missing-KEY error deep inside assertMetricParity
# instead of a clear "fixture schema invalid" message. This test reads the
# COMMITTED fixture directly and asserts its top-level + well-known nested
# shape, so a malformed fixture fails HERE with an actionable message.
# ---------------------------------------------------------------------------

# Well-known keys that any valid golden_252d_expected.json must carry. These
# are intentionally a SUBSET (a few load-bearing names per section), not the
# full key list — the goal is a fast "this is structurally a metrics fixture"
# gate at load time, not a second parity assertion.
_REQUIRED_TOP_LEVEL_KEYS = {"metrics_json", "sibling"}
_REQUIRED_METRICS_JSON_KEYS = {
    "cagr",
    "sharpe",
    "sortino",
    "volatility",
    "max_drawdown",
    "trade_metrics",
}
_REQUIRED_SIBLING_KEYS = {
    "daily_returns_grid",
    "rolling_beta",
    "rolling_alpha",
    "exposure_series",
}


def test_golden_252d_expected_fixture_schema_is_valid():
    """The committed golden_252d_expected.json must have a well-formed schema.

    Fails with a clear, actionable message at load time if the fixture is
    truncated, replaced with `{}`, or missing a load-bearing section — instead
    of the confusing deep missing-key error from assertMetricParity that
    H-0753 describes."""
    data = json.loads(
        (FIXTURES_DIR / "golden_252d_expected.json").read_text()
    )

    assert isinstance(data, dict) and data, (
        "golden_252d_expected.json is empty or not a JSON object — fixture is "
        "truncated or was overwritten with {} during a bad regen"
    )

    missing_top = _REQUIRED_TOP_LEVEL_KEYS - data.keys()
    assert not missing_top, (
        f"golden_252d_expected.json missing required top-level key(s): "
        f"{sorted(missing_top)}. The fixture is semantically invalid; "
        f"regenerate via `python -m tests.fixtures.regen_golden`."
    )

    mj = data["metrics_json"]
    assert isinstance(mj, dict) and mj, "metrics_json section is empty / not a dict"
    missing_mj = _REQUIRED_METRICS_JSON_KEYS - mj.keys()
    assert not missing_mj, (
        f"golden_252d_expected.json['metrics_json'] missing well-known key(s): "
        f"{sorted(missing_mj)} — fixture schema drifted or is truncated."
    )

    sib = data["sibling"]
    assert isinstance(sib, dict) and sib, "sibling section is empty / not a dict"
    missing_sib = _REQUIRED_SIBLING_KEYS - sib.keys()
    assert not missing_sib, (
        f"golden_252d_expected.json['sibling'] missing well-known key(s): "
        f"{sorted(missing_sib)} — fixture schema drifted or is truncated."
    )


def test_golden_252d_expected_conftest_fixture_matches_committed_file(
    golden_252d_expected,
):
    """The conftest fixture must return exactly the committed file's parsed
    content (no transformation), so the schema gate above also governs what
    every parity test consumes."""
    committed = json.loads(
        (FIXTURES_DIR / "golden_252d_expected.json").read_text()
    )
    assert golden_252d_expected == committed, (
        "conftest.golden_252d_expected diverged from the committed fixture file"
    )
    # And the fixture the parity tests consume satisfies the same schema gate.
    assert _REQUIRED_TOP_LEVEL_KEYS <= golden_252d_expected.keys()
