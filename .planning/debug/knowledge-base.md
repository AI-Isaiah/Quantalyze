# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## e2e-seeded-lane-flake — full-flow factsheet test hung 60 s or passed vacuously on /browse/crypto-sma
- **Date:** 2026-10-02
- **Error patterns:** locator.getAttribute timeout 60000ms, table tbody tr a, /browse/crypto-sma, flaky on first attempt, passed on retry, local-stack lane, is_example, Hide examples, hydration
- **Root cause(s):** lane crypto-sma holds only is_example rows (seed inserts examples only); StrategyTable SSRs all rows then hides examples on mount for anonymous visitors (hide_examples=true default); the test sampled the first paint once and wrapped its assertions in a silent `if (hasStrategies)` branch
- **Fix:** e2e/full-flow.spec.ts waits for the hydrated default (Hide examples checked), unticks it (focus + Space), requires a /factsheet/ row and asserts the factsheet names it; no conditional around assertions
- **Files changed:** e2e/full-flow.spec.ts
- **Why not caught:** no gate existed for this class; the silent branch turned an empty table into a pass, and shared TEST's accumulated non-example rows hid the data dependency
- **Recurrence guard:** e2e/full-flow.spec.ts "factsheet page loads for published strategy" fails on an empty browse table (negative probe measured); KB pattern: a single isVisible() sample on an SSR paint that a mount effect then filters
---

## redact-bridge-xdist-flake — redact-bridge tests read an empty log under pytest-xdist
- **Date:** 2026-11-26
- **Error patterns:** test_stdlib_redact_bridge.py, expected [REDACTED] marker; got: '', AssertionError, captured log empty, pytest -n auto, passes alone, passes on re-run, different victims each run
- **Root cause(s):** tests/test_deribit_options_smoothed_probe.py::test_main_prints_only_the_exception_type_on_failure (added in #1351) called the probe's main(), which runs logging.disable(logging.CRITICAL) process-wide and never undoes it; later tests on the same xdist worker drop every WARNING/ERROR record at Logger.isEnabledFor
- **Fix:** the test requests a _logging_restored fixture that calls logging.disable(logging.NOTSET) on teardown (same shape as the sibling probe test files); merged as #1356 (a8499797b, v0.133.81.2)
- **Files changed:** analytics-service/tests/test_deribit_options_smoothed_probe.py
- **Why not caught:** the failure needs the polluter and a victim on the same worker in that order, so the file passed alone and on re-run
- **Recurrence guard:** KB pattern: a script main() that calls logging.disable must be reset in its test's teardown; scripts/navbreach_anchor_probe.main() carries the same latent disable (its only test exits in argparse first)
---
