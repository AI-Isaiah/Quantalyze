---
phase: 185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t
plan: 08
subsystem: analytics-worker
tags: [deribit, key-mode, options-basis, smoothed-mtm, same-crawl, seam, apply-marks, tdd]
status: complete

requires:
  - phase: 185-deribitflowtime
    provides: "plan 185-07: build_deribit_native_ledger(retain_raw_rows), CompletenessReport.raw_rows, build_deribit_options_basis_ledger, the SC-5 fixture"
  - phase: 185-deribitflowtime
    provides: "plan 185-06: f1-answer f1-a, f6-answer f6-a, f5-answer f5-a"
  - phase: 185-deribitflowtime
    provides: "plan 185-04: the options_cash_basis flag and f3-answer removal=a (this plan narrows its setter)"
provides:
  - "_KEY_MODE_OPTIONS_BASES = (smoothed_mtm,): the ordered options bases a key-mode Deribit derive tries (F1)"
  - "the key-mode options step in run_derive_broker_dailies_job: an option-activity key's headline is assembled from the cash crawl's retained rows, and native_ledger, returns and meta are rebound so every writer quantity reads one ledger"
  - "a local structural fallback to the cash ledger (the six SMTM-01 classes only), with the options_cash_basis caveat raised only while a key ended on cash"
  - "key_inputs options_basis (present-only string)"
  - "tests/test_deribit_key_mode_options_basis.py (tracer, fallback, gates, the five-part seam test) and the rewritten key-mode contract in tests/test_mtm_single_key.py"
affects: [185-09, 185-10]

requirements-completed: [SC-2, SC-5]

plan_head_before: 634ce20ba54dafb17c29061f0a9aeccc15c13149
plan_head_after: ecfc4aedc1a2a47d9a2b3876d0696e376e8ba7e5
actuals:
  tokens: 11300
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "headline-not-additive options basis for a key: rebind native_ledger, returns and meta once, so day P&L, composed flows, realized terminal, flow instants and the apply_marks writer terminal all read the same ledger"
    - "retained raw rows released on the report right after the one step that reads them"

key-files:
  created:
    - analytics-service/tests/test_deribit_key_mode_options_basis.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_mtm_single_key.py

key-decisions:
  - "F1 f1-a: _KEY_MODE_OPTIONS_BASES holds the smoothed basis only; the tuple shape lets a later choice name a second basis without touching the step."
  - "F6 f6-a: no switch and no reuse of SMOOTHED_MTM_ENABLED; closed_sets.py is untouched (rollback is reverting the merge)."
  - "F5 f5-a: strategy mode untouched; its MTM and smoothed passes keep their not is_key_mode gates (zero removed lines match)."
  - "The step catches exactly the smoothed third pass's six structural classes. A transient (DeribitTransientReadError) and a bare ValueError propagate, both pinned."
  - "native_inception_diagnostics, ledger_digest and account_summary stay the cash pass's captures (taken before anything can refuse, MD-01); a comment at the capture says so."

duration: 16min
completed: 2026-11-01
---

# Phase 185 Plan 08: key mode values Deribit options at market from one crawl Summary

**A Deribit allocator key with option activity is now built on the founder's smoothed basis from its one crawl, every writer quantity reads that one ledger, and the first marked day joins it with no day counted twice; a structural failure falls back to cash and keeps the caveat.**

## Performance

- **Duration:** 16 min (2026-11-01T18:57:19Z to 19:13:17Z at the last code commit, plus the SUMMARY)
- **Tasks:** 2 (1 tracer, 1 auto), 3 commits (RED, GREEN, seam)
- **Files:** 2 modified, 1 created (all under `analytics-service/`)

## Accomplishments

- **Tracer (SC-5):** the key-mode derive over the shared round-trip fixture persists `(0.0000, +0.1740, +0.9586)` within 5e-4. On the cash basis it persists `(-0.4839, +0.0280, +3.3339)`; the RED run failed on exactly that (`Obtained: -0.4839, Expected: 0.0 +- 5e-4`).
- **One ledger, one crawl:** the cash build is asked for `retain_raw_rows=True` on the key-mode NAV path only; the options ledger is assembled from those rows (`len(calls) == 1`), run through `combine_native_ledger` off the loop with `denominator_config=None`, and on success `native_ledger`, `returns` and `meta` are rebound before `_day_pnl_usd` is read. The retained rows are released on the report straight after the step.
- **Option-activity keys only:** the step runs on a strict `has_option_activity is True`; a perp-only key never reaches the assembler and its persisted rows and payload equal those of the same derive with the assembler patched to raise. A truthy non-bool (`1`, `"true"`) does not raise the step either.
- **Local fallback:** the six structural classes degrade to the cash ledger, the derive ends DONE on the cash oracle, `options_cash_basis` is True and `options_basis` is absent. The 185-04 setter now reads `has_option_activity is True and _options_basis_applied is None`, after the step, so the caveat clears itself where the options basis applied (F3 removal=a). The epilogue writes `options_basis` present-only, so exactly one of the two keys is ever written.
- **Seam (RESEARCH Q6, G-01):** through the real derive and the real compose, with the option book open at `S-1`: days before `S` are the options ledger's own returns; days on and after `S` are exactly `{S, S+2}`; no day is written twice; the gap day is absent and `mark_gap_days == [S+1]`; the compose lands on both marked NAVs and on the options level at `S-1` (1.1740 S0), with no blocking degrade; `r(S) = 0.0221` against the options base, where the cash-wallet base would have booked 1.2621.

## Task Commits

1. **Task 1 (tracer) RED** - `7bf7557bd` (test): the tracer, bases-constant, fallback and transient tests failed on assertions; the perp-only and strict-true tests passed as pins.
2. **Task 1 (tracer) GREEN** - `a27e3f96f` (feat): constant, retained rows, options step, narrowed caveat, `options_basis`.
3. **Task 2** - `ecfc4aedc` (test): the five-part seam test.

**Plan metadata:** the commit that adds this file (docs).

## RED evidence

`red1.log` holds 5 failed, 3 passed. Semantic assessment: the target tests executed and failed on the planned assertion (`-0.4839 == 0.0 +- 5e-4`, `getattr(job_worker, "_KEY_MODE_OPTIONS_BASES", None) == (smoothed_mtm,)`, the assembler "Awaited 0 times", `DID NOT RAISE DeribitTransientReadError`, and `retain_raw_rows is True` on the rewritten contract), not on an import, syntax or fixture fault. The constant is resolved lazily so the RED is an assertion and not a collection error. The two pins that passed before the change are `test_key_mode_perp_only_book_never_calls_the_options_assembler` and `test_the_options_step_runs_only_on_a_strict_true`; both are proven able to fail by the gate drill below. The seam test (Task 2) was a pin on Task 1's code by design and is proven by its drill.

## Neuter drills (byte backup, restore, `cmp` each time)

| # | Neuter | Result |
|---|---|---|
| 1 (plan) | delete the `returns` rebind (`returns, meta = ...` becomes `meta = ...`) | `neuter1.log`: tracer FAILED (`-0.4839 == 0.0`), 1 failed 6 passed. Restored, `cmp` clean. |
| 2 (plan, the hybrid) | day P&L, realized terminal and composed flows read the CASH ledger while `returns` stays on the options ledger | `neuter2.log`: seam test FAILED at (v) (`1.2620 == 0.0221`, the whole open option book booked as one day's return) and the tracer FAILED on the cash day P&L (`-48390 == 0`). Restored, `cmp` clean against `.bak2` and `.bak`. |
| 3 | gate `has_option_activity is True` becomes `True` | perp-only test and both strict-true cases FAILED (3). Restored, `cmp` clean. |
| 4 | drop `and _options_basis_applied is None` from the caveat | tracer FAILED (`options_cash_basis` would be written beside `options_basis`). Restored, `cmp` clean. |
| 5 | replace the six-class catch with `KeyboardInterrupt` | the fallback test FAILED. Restored, `cmp` clean. |
| 6 | add `DeribitTransientReadError` to the catch | the transient test FAILED. Restored, `cmp` clean. |

One harness fault surfaced during drill 2 and was fixed before its result was recorded: importing the module-autouse `_real_marks_writer` fixture from `test_nav_marks_writer` re-bound the real marks writer for every test in the module and broke the tracer tests (`NavMarkError`). The seam test now asks for a plain, non-autouse `real_marks_writer` fixture; the first drill-2 run was discarded and redone.

## Verification

- `pytest tests/test_deribit_key_mode_options_basis.py tests/test_mtm_single_key.py tests/test_options_cash_basis_caveat.py tests/test_job_worker_deribit.py tests/test_allocator_equity_writer_basis.py tests/test_cash_basis_series_sc4.py tests/test_derive_broker_dailies_dualmode.py`: **208 passed** (run with `python3`, 3.14).
- New module alone: **8 passed**.
- Full suite from `analytics-service/` with the repo venv (3.12): `.venv/bin/python -m pytest -n auto --dist loadgroup -q -p no:cacheprovider`: **14106 passed, 102 skipped, 0 failed** (the skips are the suite's existing environment-gated tests; none was added by this plan).
- CI's mypy line, verbatim, with the venv's mypy: `Success: no issues found in 131 source files`.
- Acceptance greps: `_KEY_MODE_OPTIONS_BASES` 3 (needs at least 2); `_key_inputs_payload["options_basis"]` 1; `def test_key_mode_never_runs_second_pass` 0 and the module docstring no longer names it; `git diff <base> -- job_worker.py` holds 0 removed lines matching `not is_key_mode`; `git diff --stat <base> -- closed_sets.py` prints nothing (f6-a).

## Decisions Made

- F1/F6/F5 branches implemented: **f1-a** (smoothed), **f6-a** (no switch), **f5-a** (strategies stay cash). The f1-c second-basis behavior and the f6-b/f6-c switch behaviors in the plan are not implemented because those answers were not given.
- The plan's step wording "stop" after the first successful basis is a `break` in a `for ... in _KEY_MODE_OPTIONS_BASES` loop that `continue`s on a structural failure.
- `PNL_BASIS_SMOOTHED_MTM` is imported at module level (aliased `_OPTIONS_BASIS_SMOOTHED`) for the `Final` constant; `services.deribit_txn` imports only `services.external_flows`, so no cycle or import cost was added. The function-local Deribit imports are unchanged.
- The cash-pass `since_ms` question from plan 07's "Known limit": the key-mode cash build passes no `since_ms`, so it takes the signature default `None` (full history), which is what a smoothed options build needs (WR-05). Verified by reading the call; no test pins it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tests that compared two derives needed a fixed clock and one field exempted**
- **Found during:** Task 1 (RED)
- **Issue:** the perp-only test compares two derives' payloads; `anchor_asof` and `nav_mark.marked_at` carry the derive's wall-clock read instants, so two runs of the same ledger never compare equal.
- **Fix:** the harness patches `services.job_worker._utc_now` to a fixed 00:10:30Z instant, and the comparison drops `anchor_asof` (a wall-clock field the derive reads from `datetime.now`, which the clock patch does not reach).
- **Files modified:** `analytics-service/tests/test_deribit_key_mode_options_basis.py`
- **Commit:** `7bf7557bd`

**2. [Rule 3 - Blocking] The seam test must not import the autouse marks-writer fixture**
- **Found during:** Task 2 (drill 2)
- **Issue:** see "Neuter drills" above.
- **Fix:** a local non-autouse `real_marks_writer` fixture, requested by the seam test only.
- **Files modified:** `analytics-service/tests/test_deribit_key_mode_options_basis.py`
- **Commit:** `ecfc4aedc`

---

**Total deviations:** 2 auto-fixed (1 Rule 1, 1 Rule 3), both in test harness code. **Impact on plan:** none on the shipped behavior; no pre-existing assertion was changed.

## Issues Encountered

- The full suite needs the venv's Python (xdist is not installed in the system `python3`); the targeted modules were first run on both.
- No pre-existing test broke. The default patch in `_base_patches` (the assembler refusing structurally) kept every existing key-mode option-activity test on the cash path it pins, so no assertion changed and no other harness needed a fix. The three other test modules whose `build_deribit_native_ledger` stand-ins have fixed signatures (`test_stitch_composite_job.py`, `test_nav_marks_composite_allocated.py`, `test_nav_marks_allocated.py`) are strategy or composite mode, which never passes `retain_raw_rows`.

## Known limits (recorded, not fixed)

- **No budget bound on the options step yet.** It runs unbounded inside the cash pass's outer `wait_for`; a timeout there is attributed to the cash crawl. Plan 185-09 owns the slice, the degrade arms and the bucketed-day rule, and this plan is not shipped without it (the plan's own statement).
- `native_inception_diagnostics` is the cash ledger's numbers also when the options basis applies (by design, commented at the capture).
- A day whose option marks are older than the retention window still takes its cash-basis return on the options ledger; the bucket is stamped on `meta` (`pre_mark_retention_option_dailies`, `pre_summary_rollout_option_dailies`) for the factsheet caveat. Plan 185-09 decides how that day is shown (F2).
- Marked days do not change under this phase; only pre-`S` returns, pre-`S` levels and the seam day's base do (RESEARCH A9).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema; the retained rows live on an in-memory report field with `repr=False` and are released after the step; the only new log line names the basis and venue and scrubs the exception text (no amount, instrument or key id).

## PR-2 ship notes (for the CHANGELOG)

- Allocator keys with Deribit options are now measured on the smoothed options basis, built from the same transaction-log crawl as the cash ledger (no second crawl). A day's return divides by an equity that includes the open option book, so an option trade or delivery day no longer prints as a premium loss followed by a several-hundred-percent gain.
- Perp-only keys and strategies are unchanged: the step runs only for an option-activity key, and strategy mode keeps its `not is_key_mode` gates.
- A structural options-basis failure falls back to the cash ledger and the derive still completes; the `options_cash_basis` caveat is written only while a key ended on cash, so it clears itself per key once the options basis applies. `key_inputs` gains a present-only `options_basis` string.
- The seam rule, in the words of the plan: `apply_marks` is the only join. Days before `S` (the key's first mark) keep the writer's series exactly, which for an option-activity key is the options-basis series. Day `S` is `(M_S - L(S-1) - F_S) / L(S-1)`, where `L(S-1)` is the writer's own realized level rolled from its terminal through its own day P&L and flows (G-01); with the options ledger the base includes the option book, so `r(S)` no longer absorbs it. Days after `S` are mark days only; gap days are absent and listed in `mark_gap_days`. Marks win from `S`; a day's flow is placed once.
- Ship only together with plan 185-09 (the budget bound); no switch (F6 f6-a), rollback is reverting the merge.

## Next Phase Readiness

Plan 185-09 can bound the options step inside `run_derive_broker_dailies_job`'s key-mode block (the `for _options_basis in _KEY_MODE_OPTIONS_BASES` loop) and add the F2 bucketed-day rule on top of the stamps this plan sets.

## Self-Check: PASSED

- FOUND: `analytics-service/tests/test_deribit_key_mode_options_basis.py`
- FOUND commits `7bf7557bd`, `a27e3f96f`, `ecfc4aedc` (ancestors of HEAD); `git rev-list --count <plan_head_before>..HEAD` printed 3 before this file was added.
- FOUND: `_KEY_MODE_OPTIONS_BASES` and `_key_inputs_payload["options_basis"]` in `analytics-service/services/job_worker.py`.
