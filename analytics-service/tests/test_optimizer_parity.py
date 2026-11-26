"""Python half of the TS<->Python optimizer convention parity (Phase 28, OPT-02).

Both this file and src/lib/scenario-optimizer-parity.test.ts assert their own
constants against the SINGLE shared fixture tests/fixtures/optimizer_parity.json.
If the Python optimizer's traditional clock, sample floor (60), or per-strategy
observation gate (10) drifts from the frontend's, one of the two suites fails CI.

Phase 236 plan 04: the optimizer no longer owns a clock constant. It takes the blend's
frequency clock per request (`periods_per_year`), so the fixture's `trading_days` is pinned
against the shared traditional-clock constant the request may carry.
"""

import json
import pathlib

from services.figure_conventions import PERIODS_PER_YEAR_TRADITIONAL
from services.optimizer import SAMPLE_FLOOR, MIN_OBS_PER_STRATEGY

_FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "optimizer_parity.json"


def test_python_constants_match_the_shared_parity_fixture():
    fx = json.loads(_FIXTURE.read_text())
    assert PERIODS_PER_YEAR_TRADITIONAL == fx["trading_days"]
    assert SAMPLE_FLOOR == fx["sample_floor"]
    assert MIN_OBS_PER_STRATEGY == fx["min_obs_per_strategy"]
