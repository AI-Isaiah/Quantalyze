---
status: resolved
trigger: "analytics-service/tests/test_stdlib_redact_bridge.py flakes in CI's python job (pytest-xdist); captured log output comes back EMPTY (PR #1352 head 8c0453b8f on gw2; PR #1354 head f615d8ec4). File alone passes locally."
created: 2026-11-26T00:00:00Z
updated: 2026-11-26T00:00:00Z
---

## Current Focus

bug_class: Bohrbug (order-dependent test pollution; deterministic given the order)
hypothesis: tests/test_deribit_options_smoothed_probe.py::test_main_prints_only_the_exception_type_on_failure calls probe.main(), which runs logging.disable(logging.CRITICAL) and never restores it; every later test on the same xdist worker sees root.manager.disable=50, so Logger.isEnabledFor(WARNING/ERROR) is False and the redact-bridge capture handler receives nothing.
test: CONFIRMED (see Evidence)
next_action: none -- resolved, fix merged as #1356 (a8499797b, v0.133.81.2); session archived.
reasoning_checkpoint:
  hypothesis: "test_main_prints_only_the_exception_type_on_failure calls probe.main(), whose logging.disable(CRITICAL) is process-global and never undone, so later same-worker tests have isEnabledFor(WARNING)=False and their capture handlers get nothing"
  confirming_evidence:
    - "polluter-first ordered run: 11 failed / 7 passed, messages byte-match CI (expected [REDACTED] marker; got: '')"
    - "direct probe: manager.disable 0 -> 50 across probe.main(); isEnabledFor(WARNING) False even after setLevel(DEBUG)"
    - "controls: victim file alone 17 passed; reverse order 18 passed"
  falsification_test: "fixture restore applied and the polluter-first run still fails"
  fix_rationale: "restores the process-global the polluter changes, at the polluter, using the sibling files' existing _logging_restored fixture"
  blind_spots: "the CI worker ordering (polluter before victims on gw2) is inferred, not observed in a CI log; CI pytest is not verbose"
  candidate_causes:
    - "code(test): a test leaks logging.disable (CONFIRMED)"
    - "code(test): a test leaks a disabled logger / dictConfig disable_existing_loggers (none found by grep)"
    - "environment: CI-only logging config or plugin (eliminated: reproduces locally, serial, no plugins beyond the repo's)"
  and_gate: "yes, two conditions: the polluter test AND a victim test scheduled after it on the same xdist worker with no sibling _logging_restored teardown between them. That is why CI saw 2 failures per run and the serial repro sees 11"


## Symptoms

expected: every redact-bridge test sees its WARNING/ERROR line, scrubbed, in the capture buffer
actual: buffer is '' (e.g. "expected [REDACTED] marker; got: ''")
errors: AssertionError at test_stdlib_redact_bridge.py:74 and :90 (PR #1354); test_stdlib_logger_scrubs_dict_args_branch + test_scrub_never_drops_a_record_by_eating_a_format_placeholder on gw2 (PR #1352)
reproduction: CI python job, pytest -n auto; passes on re-run; passes alone
started: both failing heads contain 3081bdf8b (#1351, Phase 252 DERIBITOPTIONS), which ADDED scripts/deribit_options_smoothed_probe.py and its test

## Eliminated

## Evidence

- timestamp: 2026-11-26
  checked: the victim tests
  found: each attaches a StreamHandler directly to logger "quantalyze.analytics" and sets level DEBUG; output '' means the handler never ran. Only logger.disabled, a global logging.disable(), or a logger filter can suppress that.
  implication: look for global logging.disable / disabled loggers leaked by another test

- timestamp: 2026-11-26
  checked: grep for logging.disable / dictConfig / disable_existing_loggers / .disabled= / setLogRecordFactory across analytics-service
  found: six scripts call logging.disable(logging.CRITICAL) in main(); four of their test files reset with logging.disable(logging.NOTSET); test_deribit_options_smoothed_probe.py:783 calls probe.main(["--strategy-id", ...]) and does NOT reset; test_navbreach_anchor_probe only calls main([]) which exits in argparse before the disable
  implication: candidate polluter identified

- timestamp: 2026-11-26
  checked: git history
  found: scripts/deribit_options_smoothed_probe.py and its test were added in 3081bdf8b (#1351); 3081bdf8b is an ancestor of both failing heads (8c0453b8f, f615d8ec4)
  implication: timing matches the onset

## Resolution

root_cause: tests/test_deribit_options_smoothed_probe.py::test_main_prints_only_the_exception_type_on_failure (added in #1351) calls scripts/deribit_options_smoothed_probe.main(), which runs logging.disable(logging.CRITICAL) process-wide and is never undone. Later tests on the same xdist worker have every WARNING/ERROR record dropped at Logger.isEnabledFor, so test_stdlib_redact_bridge.py's capture handler sees ''.
fix: the test now requests a _logging_restored fixture (same shape as test_derivegaps_probe / test_bybit_upnl_probe / test_walletoffset_probe) that calls logging.disable(logging.NOTSET) on teardown.
fix_commit: "#1356, merge a8499797b (v0.133.81.2)"
verification: polluter-first pair 11 failed/7 passed before, 18 passed after; revert-by-byte-backup brings back 11 failed, restore gives 18 passed; per-test leak audit over all six logging-disabling probe test files reports only this test before the fix and none after (560 passed); full deribit file + redact file at -n 2: 76 passed; mypy --strict on the touched file clean.
oracle_type: specified (the redact-bridge assertions themselves) plus a derived per-test invariant (manager.disable == NOTSET after each test)
files_changed: [analytics-service/tests/test_deribit_options_smoothed_probe.py]
latent: scripts/navbreach_anchor_probe.main() has the same process-global disable; its only test exits in argparse first, so it does not leak today.

- timestamp: 2026-11-26
  checked: ordered repro `pytest -p no:xdist <polluter> tests/test_stdlib_redact_bridge.py` (pytest-randomly not installed in the venv)
  found: 11 failed / 7 passed, failure text identical to CI. Victim file alone 17 passed; reverse order 18 passed. Direct call: manager.disable 0 -> 50 after probe.main()
  implication: hypothesis confirmed, Bohrbug given the order

- timestamp: 2026-11-26
  checked: per-test leak audit (hookwrapper reporting any test leaving manager.disable non-zero) over the six probe test files whose scripts disable logging
  found: unfixed tree flags exactly test_main_prints_only_the_exception_type_on_failure; fixed tree flags none (560 passed)
  implication: no second polluter of this class in those files
