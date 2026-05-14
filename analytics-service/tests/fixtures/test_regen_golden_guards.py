"""audit-2026-05-07 P1689 / P2006: regen_golden CLI guard tests.

The regen script imports the same helpers that ``test_metrics_parity.py``
asserts against. If we let it overwrite the golden fixture silently, a math
bug bakes into the fixture and parity passes anyway. This file pins the
behaviour of the new CLI flags:

- ``--i-am-fixing-a-real-bug`` is REQUIRED (no flag → SystemExit(2)).
- ``--accept-numpy-drift`` is required when scalar drift > 1% on > 3 keys.
- With both flags + small / no drift, regen completes.

Run: ``cd analytics-service && pytest tests/fixtures/test_regen_golden_guards.py``
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import pytest

from tests.fixtures import regen_golden

FIXTURES_DIR = Path(regen_golden.__file__).parent


@pytest.fixture
def isolated_fixtures_dir(tmp_path, monkeypatch) -> Path:
    """Point regen_golden at a tmp dir so tests don't touch the committed fixture."""
    monkeypatch.setattr(regen_golden, "FIXTURES_DIR", tmp_path)
    return tmp_path


def test_main_without_acknowledgement_flag_exits_2(isolated_fixtures_dir):
    """audit-2026-05-07 P1689: bare `python -m regen_golden` must refuse."""
    with pytest.raises(SystemExit) as exc:
        regen_golden.main([])
    assert exc.value.code == 2


def test_main_with_acknowledgement_writes_fresh_fixture(isolated_fixtures_dir):
    """Both fixture files should land when no prior fixture exists."""
    regen_golden.main(["--i-am-fixing-a-real-bug"])
    expected_path = isolated_fixtures_dir / "golden_252d_expected.json"
    input_json = isolated_fixtures_dir / "golden_252d_input.json"
    input_parquet = isolated_fixtures_dir / "golden_252d_input.parquet"
    assert expected_path.exists()
    assert input_json.exists()
    assert input_parquet.exists()
    payload = json.loads(expected_path.read_text())
    # audit-2026-05-07 P2005: _fixture_has_maker_taker MUST be pinned in.
    assert "_fixture_has_maker_taker" in payload
    assert isinstance(payload["_fixture_has_maker_taker"], bool)


def test_main_rejects_heavy_drift_without_accept_flag(
    isolated_fixtures_dir, monkeypatch
):
    """audit-2026-05-07 P2006: > 3 scalar keys with > 1% drift must SystemExit."""
    # Pre-seed a synthetic prior fixture whose scalars are off by 5% on 5 keys.
    prior: dict[str, Any] = {
        "_fixture_has_maker_taker": False,
        "metrics_json": {
            "cagr": 1.0,
            "calmar": 1.0,
            "cumulative_return": 1.0,
            "sharpe": 1.0,
            "sortino": 1.0,
            "max_drawdown": 1.0,
        },
        "sibling": {},
    }
    expected_path = isolated_fixtures_dir / "golden_252d_expected.json"
    expected_path.write_text(json.dumps(prior, indent=2, sort_keys=True))
    # Confirm the synthetic prior is in place
    assert expected_path.exists()
    # The freshly-computed fixture will drift from these synthetic 1.0
    # scalars on FAR more than 3 keys, so this must SystemExit(3).
    with pytest.raises(SystemExit) as exc:
        regen_golden.main(["--i-am-fixing-a-real-bug"])
    assert exc.value.code == 3
    # The original synthetic fixture must NOT have been overwritten.
    assert json.loads(expected_path.read_text()) == prior


def test_main_with_both_flags_overwrites_on_drift(
    isolated_fixtures_dir, monkeypatch
):
    """Both flags allow regen even with heavy drift (the escape hatch)."""
    prior: dict[str, Any] = {
        "_fixture_has_maker_taker": False,
        "metrics_json": {
            "cagr": 999.0,
            "calmar": 999.0,
            "cumulative_return": 999.0,
            "sharpe": 999.0,
            "sortino": 999.0,
            "max_drawdown": 999.0,
        },
        "sibling": {},
    }
    expected_path = isolated_fixtures_dir / "golden_252d_expected.json"
    expected_path.write_text(json.dumps(prior, indent=2, sort_keys=True))
    regen_golden.main(["--i-am-fixing-a-real-bug", "--accept-numpy-drift"])
    fresh = json.loads(expected_path.read_text())
    # The drift acknowledgement overwrote the synthetic prior.
    assert fresh != prior
    assert "_fixture_has_maker_taker" in fresh


def test_scalar_drift_summary_skips_series(isolated_fixtures_dir):
    """Internal helper: lists must be skipped, scalar drift must be reported."""
    drifts = regen_golden._scalar_drift_summary(
        {
            "a": 1.0,
            "b": 2.0,
            "series": [1, 2, 3],
            "nested": {"c": 4.0},
        },
        {
            "a": 1.05,
            "b": 2.0,
            "series": [9, 9, 9],
            "nested": {"c": 4.4},
        },
    )
    assert "series" not in drifts
    assert pytest.approx(drifts["a"], rel=1e-6) == 0.05
    assert pytest.approx(drifts["b"], rel=1e-6) == 0.0
    assert pytest.approx(drifts["nested.c"], rel=1e-6) == 0.1


def test_scalar_drift_summary_reports_missing_keys_as_inf(isolated_fixtures_dir):
    """Missing keys on either side surface as infinite drift (contract drift)."""
    drifts = regen_golden._scalar_drift_summary(
        {"a": 1.0, "b": 2.0},
        {"a": 1.0, "c": 3.0},
    )
    assert drifts["b"] == float("inf")
    assert drifts["c"] == float("inf")


def test_scalar_drift_summary_dict_to_scalar_flip_is_inf(isolated_fixtures_dir):
    """audit-2026-05-07 round-2-G follow-up: shape flips surface as inf.

    Pre-fix the dict↔scalar branch fell through silently — a key whose
    value flipped from {...} to 0.5 (or vice versa) produced no drift
    entry. A real contract drift would slip the gate.
    """
    drifts = regen_golden._scalar_drift_summary(
        {"a": {"nested": 1.0}},
        {"a": 0.5},
    )
    assert drifts["a"] == float("inf")
    drifts = regen_golden._scalar_drift_summary(
        {"a": 0.5},
        {"a": {"nested": 1.0}},
    )
    assert drifts["a"] == float("inf")


def test_scalar_drift_summary_zero_to_zero_is_silent(isolated_fixtures_dir):
    """(0, 0) matches are not recorded — no drift signal to emit."""
    drifts = regen_golden._scalar_drift_summary({"a": 0.0}, {"a": 0.0})
    assert "a" not in drifts


def test_check_drift_or_die_magnitude_trip(
    isolated_fixtures_dir, monkeypatch, capsys
):
    """audit-2026-05-07 round-2-G: single catastrophic scalar (> 5%) trips.

    Pre-fix the gate only fired on > 3 keys with > 1% drift — a 100%
    regression on `sharpe` alone slipped through. The magnitude arm now
    catches it.
    """
    prior = {
        "_fixture_has_maker_taker": False,
        # Match the freshly-computed scalars exactly on N-1 keys, then
        # diverge by > 5% on a single scalar. This drives the magnitude
        # arm without tripping the population arm.
        "metrics_json": {"sharpe": 0.001},
        "sibling": {},
    }
    fixture_path = isolated_fixtures_dir / "golden_252d_expected.json"
    fixture_path.write_text(json.dumps(prior))

    new_expected = {
        "_fixture_has_maker_taker": False,
        "metrics_json": {"sharpe": 1.0},  # 99,900% relative drift on a single key
        "sibling": {},
    }
    with pytest.raises(SystemExit) as exc:
        regen_golden._check_drift_or_die(
            fixture_path, new_expected, accept_drift=False
        )
    assert exc.value.code == 3
    captured = capsys.readouterr()
    assert "magnitude" in captured.err.lower()


def test_check_drift_or_die_magnitude_trip_accepted_with_flag(
    isolated_fixtures_dir,
):
    """The --accept-numpy-drift escape hatch still works for magnitude trips."""
    prior = {
        "_fixture_has_maker_taker": False,
        "metrics_json": {"sharpe": 0.001},
        "sibling": {},
    }
    fixture_path = isolated_fixtures_dir / "golden_252d_expected.json"
    fixture_path.write_text(json.dumps(prior))
    new_expected = {
        "_fixture_has_maker_taker": False,
        "metrics_json": {"sharpe": 1.0},
        "sibling": {},
    }
    # accept_drift=True must NOT raise even when magnitude is catastrophic.
    regen_golden._check_drift_or_die(
        fixture_path, new_expected, accept_drift=True
    )


def test_check_drift_or_die_corrupt_prior_raises(
    isolated_fixtures_dir, capsys
):
    """audit-2026-05-07 round-2-G: corrupt JSON must SystemExit(4), not silently skip.

    Pre-fix the JSONDecodeError was swallowed and the drift gate
    disabled — the worst case of "silent fixture overwrite" the branch
    is supposed to prevent.
    """
    fixture_path = isolated_fixtures_dir / "golden_252d_expected.json"
    fixture_path.write_text("not valid json {{{")
    with pytest.raises(SystemExit) as exc:
        regen_golden._check_drift_or_die(
            fixture_path, {"metrics_json": {}}, accept_drift=False
        )
    assert exc.value.code == 4
    captured = capsys.readouterr()
    assert "not valid JSON" in captured.err


def test_check_drift_or_die_missing_prior_is_allowed(isolated_fixtures_dir):
    """Fresh-from-empty regen (no prior fixture) is the only silent-pass path."""
    fixture_path = isolated_fixtures_dir / "golden_252d_expected.json"
    assert not fixture_path.exists()
    # No raise — early return when prior fixture is absent is correct.
    regen_golden._check_drift_or_die(
        fixture_path, {"metrics_json": {"sharpe": 1.0}}, accept_drift=False
    )


def test_check_drift_or_die_three_keys_just_above_one_percent_passes(
    isolated_fixtures_dir,
):
    """Boundary pin (red-team #3): exactly 3 heavy keys must NOT trip.

    The population gate uses strict `>` (> _DRIFT_HEAVY_KEY_COUNT == > 3),
    so exactly 3 keys at 2% drift should pass while 4 keys would trip.
    """
    prior = {
        "metrics_json": {"a": 1.0, "b": 1.0, "c": 1.0, "d": 1.0},
        "sibling": {},
    }
    fixture_path = isolated_fixtures_dir / "golden_252d_expected.json"
    fixture_path.write_text(json.dumps(prior))
    new_expected = {
        "metrics_json": {"a": 1.02, "b": 1.02, "c": 1.02, "d": 1.0},
        "sibling": {},
    }
    # 3 heavy keys (a/b/c at 2%), 1 unchanged (d). 3 is NOT > 3 → no trip.
    # No catastrophic key either (2% < 5%). Must pass.
    regen_golden._check_drift_or_die(
        fixture_path, new_expected, accept_drift=False
    )


def test_check_drift_or_die_four_keys_just_above_one_percent_trips(
    isolated_fixtures_dir,
):
    """Boundary pin (red-team #3): exactly 4 heavy keys MUST trip the population arm."""
    prior = {
        "metrics_json": {"a": 1.0, "b": 1.0, "c": 1.0, "d": 1.0},
        "sibling": {},
    }
    fixture_path = isolated_fixtures_dir / "golden_252d_expected.json"
    fixture_path.write_text(json.dumps(prior))
    new_expected = {
        "metrics_json": {"a": 1.02, "b": 1.02, "c": 1.02, "d": 1.02},
        "sibling": {},
    }
    # 4 heavy keys at 2% — 4 > 3 → population trip. No catastrophic key.
    with pytest.raises(SystemExit) as exc:
        regen_golden._check_drift_or_die(
            fixture_path, new_expected, accept_drift=False
        )
    assert exc.value.code == 3


def test_check_drift_or_die_just_under_five_percent_passes(
    isolated_fixtures_dir,
):
    """Boundary pin (red-team #3): a hair under 5% magnitude must NOT trip.

    The magnitude gate uses strict `>` (> _DRIFT_MAGNITUDE_THRESHOLD == > 0.05).
    A flip to `>=` would silently trip on legitimate sub-5% drifts.
    Uses 4.99% to avoid IEEE-754 representational drift around 1.05/1.0
    which lands a hair above 0.05.
    """
    prior = {
        "metrics_json": {"a": 1.0},
        "sibling": {},
    }
    fixture_path = isolated_fixtures_dir / "golden_252d_expected.json"
    fixture_path.write_text(json.dumps(prior))
    new_expected = {
        "metrics_json": {"a": 1.0499},  # 4.99% drift — unambiguously < 5%
        "sibling": {},
    }
    # 1 heavy key (1 < 4 → no population trip), 4.99% (NOT > 5%). Must pass.
    regen_golden._check_drift_or_die(
        fixture_path, new_expected, accept_drift=False
    )


def test_check_drift_or_die_just_above_five_percent_trips(isolated_fixtures_dir):
    """Boundary pin (red-team #3): a hair above 5% MUST trip the magnitude arm."""
    prior = {
        "metrics_json": {"a": 1.0},
        "sibling": {},
    }
    fixture_path = isolated_fixtures_dir / "golden_252d_expected.json"
    fixture_path.write_text(json.dumps(prior))
    new_expected = {
        "metrics_json": {"a": 1.0500001},  # 5.00001% drift — > 5% is True
        "sibling": {},
    }
    with pytest.raises(SystemExit) as exc:
        regen_golden._check_drift_or_die(
            fixture_path, new_expected, accept_drift=False
        )
    assert exc.value.code == 3


def test_check_drift_or_die_population_trip_unchanged(isolated_fixtures_dir):
    """The original > 3 keys × > 1% drift trip still fires (no regression)."""
    prior = {
        "_fixture_has_maker_taker": False,
        "metrics_json": {
            "cagr": 1.0,
            "calmar": 1.0,
            "cumulative_return": 1.0,
            "sharpe": 1.0,
            "sortino": 1.0,
            # Each key drifts ~3% from these values to fresh — not catastrophic
            # (under 5%), but population-wide.
        },
        "sibling": {},
    }
    fixture_path = isolated_fixtures_dir / "golden_252d_expected.json"
    fixture_path.write_text(json.dumps(prior))
    new_expected = {
        "_fixture_has_maker_taker": False,
        "metrics_json": {
            "cagr": 1.03,
            "calmar": 1.03,
            "cumulative_return": 1.03,
            "sharpe": 1.03,
            "sortino": 1.03,
        },
        "sibling": {},
    }
    with pytest.raises(SystemExit) as exc:
        regen_golden._check_drift_or_die(
            fixture_path, new_expected, accept_drift=False
        )
    assert exc.value.code == 3
