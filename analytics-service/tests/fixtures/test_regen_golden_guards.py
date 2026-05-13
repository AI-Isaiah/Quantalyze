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
