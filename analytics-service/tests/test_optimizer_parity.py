"""Python half of the TS<->Python optimizer convention parity (Phase 28, OPT-02).

Both this file and src/lib/scenario-optimizer-parity.test.ts assert their own
constants against the SINGLE shared fixture tests/fixtures/optimizer_parity.json.
If the Python optimizer's annualization (252), sample floor (60), or per-strategy
observation gate (10) drifts from the frontend's, one of the two suites fails CI.
"""

import json
import pathlib

from services.optimizer import TRADING_DAYS, SAMPLE_FLOOR, MIN_OBS_PER_STRATEGY

_FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "optimizer_parity.json"


def test_python_constants_match_the_shared_parity_fixture():
    fx = json.loads(_FIXTURE.read_text())
    assert TRADING_DAYS == fx["trading_days"]
    assert SAMPLE_FLOOR == fx["sample_floor"]
    assert MIN_OBS_PER_STRATEGY == fx["min_obs_per_strategy"]
