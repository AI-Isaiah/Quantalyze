---
phase: 218-selfheal-the-wizard-s-mt5-key-check-heals-an-owed-terminal-s
plan: 01
subsystem: analytics-service / MT5 wizard validation
tags: [mt5, validation-terminal, scrub, wizard, selfheal, wire-contract]
status: complete

requires:
  - phase: 164.6.6.1
    provides: the validation terminal scrub, its owed mark and relaunch debt, the worker's inline owed gate
provides:
  - pay_owed_validation_scrub_in_lease (never raises, returns the kind, takes no lease)
  - budget_s plumbing through the scrub (None keeps the worker and scheduled-task behaviour)
  - owed gate in _validate_mt5_key_probe that heals inline and probes in the same request
  - MT5_TERMINAL_NOT_READY wire code and MT5_TERMINAL_NOT_READY_DETAIL
  - owed_scrub mt5.stage event and trace.outcome scrub_unhealed
affects: [218-02 (envelope floor and clamp), 218-03 (TS vocabulary row and parity EXPECTED row), 218-04]

actuals:
  tokens: 15050
  tasks: 2
  commits: 2
plan_head_before: 81d2a9eb6122958fa25f5f4cac232ac3cd6355a5
plan_head_after: 6893a151662ead9bf21b12c636d10ada1c77f32e

tech-stack:
  added: []
  patterns:
    - "never-raises sibling returning the kind (copy of run_owed_validation_scrub_in_lease's body shape)"
    - "event-loop wait bound separate from the worker-thread deadline"

key-files:
  created: []
  modified:
    - analytics-service/services/mt5_terminal_scrub.py
    - analytics-service/routers/exchange.py
    - analytics-service/services/closed_sets.py
    - analytics-service/tests/test_mt5_validation_park.py
    - analytics-service/tests/test_validate_key_venue_transient.py
    - analytics-service/tests/fixtures/validate_key_venue_transient_contract.json
    - analytics-service/tests/test_mt5_server_known.py
    - analytics-service/tests/test_mt5_session_episodes.py
    - analytics-service/tests/test_mt5_terminal_scrub.py

key-decisions:
  - "The wizard bound (_MT5_INLINE_SCRUB_BUDGET_S, 30 s) caps the event-loop wait only; the scrub thread keeps heal_deadline(_VALIDATION_SCRUB_BUDGET_S) so the credentialed relaunch stays affordable"
  - "The owed gate no longer schedules a scrub on a refusal: the post-check finally schedules only after a login, and scheduling here would race the user's Retry into lease_busy"
  - "report_scrub_owed_refusal is kept where a refusal still happens (a non-scrubbed kind)"

requirements-completed: [218-SC-1, 218-SC-2, 218-SC-3, 218-SC-5]

duration: ~95min
completed: 2026-11-19
---

# Phase 218 Plan 01: Wizard MT5 key check heals an owed terminal Summary

**The wizard now pays an owed validation-terminal scrub inline under the lease it already holds and runs the check in the same request; every non-`scrubbed` kind refuses before any client is built with a code naming the cause.**

## Accomplishments

- `services/mt5_terminal_scrub.py`: `pay_owed_validation_scrub_in_lease(host, port, *, site, budget_s) -> str`, never raises, takes no lease, falls back to `failed`. `budget_s` is plumbed through `_scrub_under_lease`, `_scrub_decide` (W-1 wait gets `min(_SCRUB_PROBE_WAIT_S, budget_s)`, the `wait_for` gets what is left of `budget_s`) and `_wait_for_unfinished_probes(wait_s=)`. `None` keeps today's values. `run_owed_validation_scrub_in_lease` is byte-unchanged. Dated CORRECTED notes added, old text kept.
- `routers/exchange.py`: owed gate rewritten. Healed: the probe runs in the same request with `probe_timeout = _MT5_VALIDATE_DEADLINE_S - scrub_elapsed` (envelope anchored at lease acquisition, server worst case stays 105 s), `owed_scrub` / `scrub_healed` stage event, INFO log. Unhealed: `report_scrub_owed_refusal`, `trace.outcome = "scrub_unhealed"`, then 500 `MT5_VALIDATION_UNCONFIGURED` (retryable false) for `skipped_no_house_credentials` or 424 `MT5_TERMINAL_NOT_READY` (recoverable) for the other five kinds. The unowed path still reads `_park_clock` exactly twice; the three D-07 park-floor tests pass unedited. The held-lease `except Mt5TerminalBusyError` arm is byte-unchanged.
- `services/closed_sets.py`: `MT5_TERMINAL_NOT_READY_DETAIL`; BUSY comment narrowed with a dated note.
- Tests: park tests rewritten to heal semantics (5 renamed), a six-kind parametrised never-probes test, an `owed_scrub` stage spy, fixture C9 re-pointed (C10 still BUSY, `TOTAL_CASES` unchanged), cascade/WIZFORM-03 sweep, never-raises roster entry, `budget_s` plumbing tests and the thread-deadline pin.

## Verification

- `pytest` on `test_mt5_validate`, `test_mt5_validation_park`, `test_mt5_terminal_scrub`, `test_validate_key_venue_transient`, `test_mt5_server_known`, `test_mt5_session_episodes`, `test_mt5_relogin`, `test_status_contract_exchange_internal`, `test_mt5_concurrency`, `test_raw_5xx_census`: 833 passed, 1 skipped (`test_mt5_validate.py:713`, "got empty parameter set", pre-existing and unrelated).
- `mypy --strict ...` (the CI line): `Success: no issues found in 142 source files`.
- All acceptance greps hit their EXPECT values (1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1); fixture JSON parses.
- Full analytics suite (`python3 -m pytest -p no:cacheprovider -q` from `analytics-service/`): 15141 passed, 93 skipped, 1 failed. The one failure, `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`, is an environment gap, not a coupling: `pytest-xdist` is not installed locally (`ModuleNotFoundError: No module named 'xdist'`, the subprocess dies on `unrecognized arguments: -n --dist`). It does not touch any file in this plan; CI installs xdist.

### Neuter-once RED proofs

1. **Probe after a non-scrubbed kind (T-218-01).** Backed up `routers/exchange.py` to the scratchpad, changed `if kind != SCRUB_KIND_SCRUBBED:` to `if False and kind != SCRUB_KIND_SCRUBBED:`. `test_scrub_wizard_owed_gate_never_probes_after_a_non_scrubbed_kind` went `6 failed, 88 deselected` (one per kind: the probe built a client, logged in, and the post-login `finally` tripped the no-schedule stub, `AssertionError: the owed gate must not schedule a scrub`). Restored from the backup, `cmp` exit 0.
2. **Wizard bound as thread deadline (T-218-03).** Backed up `services/mt5_terminal_scrub.py`, changed the thread deadline to `heal_deadline(budget_s)` when set. `test_TERMINAL_SCRUB_the_wizard_bound_never_becomes_the_scrub_threads_deadline` went RED (`assert 'relaunch_unverified' == 'scrubbed'`: a 30 s thread deadline starves the credentialed relaunch, the exact failure `_affordable` guards). Restored from the backup, `cmp` exit 0.

## Deviations from Plan

None - plan executed as written. Small test-shape adjustments, no behaviour change: the healed-path assertions count only the client's logins (the inline scrub's credentialed relaunch also logs the house account in), and the `budget_s=None` pin expects the row insert's 5 s `wait_for` after the scrub's own bound.

## Known limits (recorded, not fixed; RESEARCH Open Question 5)

`failed` includes the profile tripwire, which only an operator can clear, and `relaunch_unverified` includes `-6`, where the broker refuses our house credential. Both answer recoverable per CONTEXT, so a Retry can loop while the scrub's per-cause ERROR alert pages. Splitting them needs `ScrubRelaunchResult` data the kind does not carry.

## Expected cross-plan red (by design, closed by plan 03)

`src/lib/seam-venue-vocabulary.invariant.test.ts` (scans `analytics-service/**` for emitted codes and sees `MT5_TERMINAL_NOT_READY` with no hand-typed roster row) and `tests/lib/validate-key-venue-transient-parity.test.ts` (reads this plan's fixture, sees a code with no `EXPECTED` row) are RED until plan 03 lands. Neither was run or edited here.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or trust-boundary file access beyond the plan's threat model.

## Self-Check: PASSED

- `analytics-service/services/mt5_terminal_scrub.py`, `analytics-service/routers/exchange.py`, `analytics-service/services/closed_sets.py` and the six test/fixture files: FOUND.
- Commits `e889eedc2` (feat) and `6893a1516` (test): FOUND on `worktree-agent-218-01`.
