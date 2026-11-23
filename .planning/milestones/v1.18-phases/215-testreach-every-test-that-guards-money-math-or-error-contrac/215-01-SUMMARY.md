---
phase: 215-testreach-every-test-that-guards-money-math-or-error-contrac
plan: 01
subsystem: testing
tags: [pytest, kpi-parity, vcr-cassettes, ci-python-job]
requires: []
provides:
  - "KPI parity oracle (5 cases) runs in every plain pytest run, so the CI python job executes it"
  - "Cassette replay suite over okx and bybit only; a missing cassette fails by name"
affects: [analytics-service/tests]
tech-stack:
  added: []
  patterns: ["missing fixture = pytest.fail, never pytest.skip", "hand-typed floor on a parametrize list"]
key-files:
  created: []
  modified:
    - analytics-service/tests/test_outcomes_kpi_parity.py
    - analytics-service/tests/test_repro_key_flow.py
key-decisions:
  - "Binance replay cases retired, not recorded (CONTEXT [Cassettes]); reason dated 2026-11-15 beside _REPLAY_BROKERS"
  - "Missing cassette for a retained broker fails instead of skipping (planner choice beyond the locked decision, recorded in the plan)"
status: complete
completed: 2026-11-15
actuals:
  tokens: 2400
  tasks: 2
  commits: 2
plan_head_before: 103ac9ec1bd0e498a20a0ea1e71808bb71d6b2f3
plan_head_after: c5b8767ce3a943c81a75d26a64cdb46ea1c1ed09
---

# Phase 215 Plan 01: Parity oracle and cassette replay actually run Summary

The HAS_PY_ENV skip is gone from the KPI parity module (5 cases now pass in a plain run) and the cassette replay suite runs over okx and bybit only, with a missing cassette failing by name instead of skipping.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | SC-1 tracer: parity oracle runs in a plain pytest run | 1488af62e | analytics-service/tests/test_outcomes_kpi_parity.py |
| 2 | SC-6: retire binance cases, missing cassette fails | c5b8767ce | analytics-service/tests/test_repro_key_flow.py |

## What changed

- `test_outcomes_kpi_parity.py`: deleted the module-level `pytestmark` skipif and the now-unused `import os`; the docstring says the module runs in the CI `python` job on every PR. `HAS_PY_ENV` no longer appears anywhere under analytics-service, .github or src (`grep -rac` count of files with a hit: 0).
- `test_repro_key_flow.py`: one `_REPLAY_BROKERS = ["okx", "bybit"]` list feeds all five parametrize decorators; the binance `TEST_CREDS` entry is removed; `_skip_if_no_cassette` became `_require_cassette` (calls `pytest.fail`, names broker, scenario and the four-cassette rule); new `test_every_replay_broker_has_all_four_cassettes` with a hand-typed `len(_REPLAY_BROKERS) == 2` floor; docstring test count is now 11 (matches `--collect-only`: 8 replay + 2 synthesizer + 1 pin) and the `_CASSETTE_DIR` comment no longer describes a pending broker.

## Verification

- `cd analytics-service && python3 -m pytest -p no:cacheprovider -q -rs tests/test_outcomes_kpi_parity.py` : 5 passed, no skip, no env var exported (HAS_PY_ENV unset).
- `... tests/test_repro_key_flow.py` : 11 passed, 0 skipped.
- Both together: 16 passed.
- Acceptance greps on test_repro_key_flow.py: `"binance"` 0, `pytest.skip` 0, `_REPLAY_BROKERS` 11 (>= 7).
- `git diff --stat origin/main -- supabase/migrations` prints nothing (SC-8).
- Tracer gate: `<verify>` re-run end-to-end after Task 1 passed before Task 2 started.

## RED proofs (SC-9)

Both made from byte backups in the scratchpad, restored and `cmp`-clean; no git checkout/restore/stash used.

1. SC-1: flipped `_HAND_DERIVED_SUCCESS["o1"]` from 1 to 0. Result `2 failed, 3 passed`: `test_success_value_matches_independent_oracle` and `test_independent_oracle_agrees_with_fixture_for_kpi_rows` FAILED. Restored (`cmp` clean), re-run 5 passed.
2. SC-6: moved `analytics-service/tests/cassettes/okx/happy.yaml` away. Result `3 failed, 8 passed`, zero skipped: `test_happy_path_replays_balance_fetch[okx]`, `test_synthesized_schema_drift_makes_ccxt_raise[okx]` and `test_every_replay_broker_has_all_four_cassettes` FAILED. Moved back (`cmp` clean against backup), re-run 16 passed with the parity module. `git status` showed only the intended modified test file.

Note: the plan named only two expected failures for SC-6; a third (`test_synthesized_schema_drift_makes_ccxt_raise[okx]`, which reads happy.yaml directly through `_require_cassette`) also fails, which is the intended conversion at work.

## Deviations from Plan

None - plan executed exactly as written. mypy strict was not run: both files are tests, outside the CI mypy scope (`services/ routers/ models/ main*.py sentry_init.py`).

## Surfaced, not changed

- `scripts/repro-key-flow.sh` still carries stale prose ("replay PASS (12 cassettes)", the "Binance dropped" pre-flight comment). It is operational tooling outside this phase's scope; left untouched as the plan directed.
- CI acceptance at ship (not an executor step): the `python` job skip count should fall by at least 9 against the 68 baseline at 3f29f1539 (5 parity + 4 binance), net of other plans; the phase verifier reconciles.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema surface.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_outcomes_kpi_parity.py, analytics-service/tests/test_repro_key_flow.py
- FOUND commits 1488af62e and c5b8767ce on feat/215-testreach (2 measured from the ledger base 103ac9ec1)
