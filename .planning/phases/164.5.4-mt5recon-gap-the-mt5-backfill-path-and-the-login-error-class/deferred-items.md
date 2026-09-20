# Phase 164.5.4 — deferred items (out of scope, discovered during execution)

Logged under the executor SCOPE BOUNDARY rule: discovered while running a plan's own
`<verify>`, NOT caused by that plan's changes, and therefore not fixed here.

## [164.5.4-SESSIONMONITOR-ORDER-FLAKE] — order-dependent failure in `test_mt5_session_monitor.py`

- **Found during:** plan 01, task 3 `<verify>`
  (`pytest tests/ -q -x -k "mt5 or ingestion_mt5 or job_worker"`).
- **Symptom:** `test_CRITERION_2_a_dark_reading_drives_the_heal_with_no_human_and_no_restart`
  failed once, logging
  `mt5 session monitor: the tick did not complete inside its own 0.0s cadence`.
  A **0.0s** cadence is the tell: the assertion is racing a wall-clock budget that
  had already been consumed, not observing a behavioural defect.
- **Not caused by plan 01, measured rather than assumed:**
  `grep -ac 'mt5_validation\|classify_mt5_login_error\|_PHRASES\|_TOKENS'` returns
  **0** for BOTH `tests/test_mt5_session_monitor.py` and
  `services/mt5_session_monitor.py`. Neither the test nor its module can reach
  anything this plan changed.
- **Reproduction is order/timing dependent:** the case PASSES in isolation
  (`-k` on its own name, 1 passed); it FAILED on one whole-file run and PASSED
  (78/78) on the immediately following whole-file run; the full `-k` selection then
  went green at **1060 passed, 4 skipped**.
- **Why it is not fixed here:** a pre-existing timing flake in an unrelated module.
  Fixing it would mean re-deriving that monitor's cadence budget, which is outside
  plan 01's files and outside the phase's subject.
- **Suggested owner:** whichever phase next touches `services/mt5_session_monitor.py`.
  The durable fix is a cadence budget the test controls rather than one it races.
