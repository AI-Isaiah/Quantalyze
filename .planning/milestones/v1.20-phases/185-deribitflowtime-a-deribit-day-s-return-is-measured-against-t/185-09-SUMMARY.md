---
phase: 185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t
plan: 09
subsystem: analytics-worker
tags: [deribit, key-mode, options-basis, derive-budget, wait-for, degrade-to-cash, caveat, f2, tdd]
status: complete

requires:
  - phase: 185-deribitflowtime
    provides: "plan 185-08: the key-mode options step, _options_basis_applied, _options_cash_basis_caveat"
  - phase: 185-deribitflowtime
    provides: "plan 185-02: the dry-key lines (crawl_s, cash_s, smoothed_s, mtm_s, pre_retention_days, pre_coverage_days)"
  - phase: 185-deribitflowtime
    provides: "plan 185-06: f1-answer f1-a (smoothed), f6-answer f6-a, f5-answer f5-a"
provides:
  - "the key-mode options step bounded to _MTM_SECOND_PASS_BUDGET_FRACTION of the remaining derive budget (_options_step_timeout), a _MTM_SECOND_PASS_MIN_SECONDS refusal floor, and a local asyncio.TimeoutError arm ahead of the structural one"
  - "the F2 rule (f2-a, D-07): a bucketed option day keeps its cash-basis return, stamped and caveated, and the options_cash_basis caveat stays while any option day is at cash value"
  - "RED-first tests with four neuter drills (+1 extra) for the bound, the floor, the transient boundary and the bucketed-day rule"
affects: [185-10]

requirements-completed: [SC-2, SC-3, SC-5]

plan_head_before: 11401456c6aed8dace6439379f1d0b7f7a50a7db
plan_head_after: 5c025c7900e839a555171ad1f875f38c2f279328
actuals:
  tokens: 6586
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "per-attempt remaining-budget slice with a floor refusal and a local timeout arm, mirroring the SMTM-01 smoothed third pass (HIGH-01 / FIX-2) but bounding only the options step because key mode reuses the cash crawl"
    - "a basis that applies with bucketed cash-valued days still sets the cash-basis caveat"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_deribit_key_mode_options_basis.py

key-decisions:
  - "F2 f2-a (D-07): option days the options basis cannot value keep their cash-basis return, stamped and caveated; the options basis still applies to the key."
  - "A timeout or a below-floor refusal breaks out of the basis loop (no further basis is tried): a second chart crawl against a venue that was just too slow is the cost the bound refuses, and the remaining budget only shrinks."
  - "The bucketed-day term reads both lists (retention and coverage) without a per-basis switch: each list is populated only under its own basis, so either non-empty means the applied basis left an option day at cash value."

duration: 14min
completed: 2026-11-01
---

# Phase 185 Plan 09: the key-mode options step is budget-bounded and bucketed days follow F2 Summary

**A Deribit key's options step can no longer sink its derive: it is cancelled at 0.7 of the remaining budget, refuses to start under 60 s, and falls back to the cash ledger with the caveat, while option days the options basis cannot value keep their cash return, stamped, with the caveat held true.**

## Performance

- **Duration:** 14 min (about 19:12Z to 19:27Z)
- **Tasks:** 3 (1 decision already answered, 2 TDD), 5 commits
- **Files:** 2 modified (both under `analytics-service/`)

## Founder answer (Task 1, recorded by the orchestrator)

f2-answer: f2-a

D-07 in `185-CONTEXT.md` and the dated `CORRECTED 2026-11-01 (D-07)` note in the ROADMAP Phase 185 entry were already written; this plan added neither. Task 1's `<automated>` verify exited 0 after the SUMMARY existed, and `npx tsx scripts/check-planning-hygiene.ts` exited 0.

## Accomplishments

- **The bound (RESEARCH Q4, Pitfall 4, T-185-24).** Before each basis attempt the options step computes the remaining budget from `TIMEOUT_PER_KIND.get("derive_broker_dailies", _DERIVE_BUDGET_DEFAULT_S)` and `_derive_start`, and `_options_step_timeout = remaining * _MTM_SECOND_PASS_BUDGET_FRACTION`. The assembler call is wrapped in `asyncio.wait_for(..., timeout=_options_step_timeout)`. The combine stays on `asyncio.to_thread`.
- **The floor.** Below `_MTM_SECOND_PASS_MIN_SECONDS` the step does not start: one WARNING (seconds, budget, floor, venue), the cash ledger is kept, the loop breaks.
- **The timeout arm.** A local `except asyncio.TimeoutError`, placed before the structural arm, logs one WARNING (bounded seconds and venue) and keeps the cash ledger. Without it the timeout reaches the cash pass's outer arm, a retryable transient that re-runs the whole derive to `failed_final` (HIGH-01); the RED run showed exactly that (outcome not DONE, no `key_inputs` row).
- **Transients still retry (T-185-25).** `DeribitTransientReadError` and a bare `ValueError` are not in the structural tuple and leave the job with no `key_inputs` row. Both are pinned and a neuter drill adding the transient to the tuple turns the test RED.
- **F2 f2-a (T-185-26, SC-3, SC-5).** The applied options report's bucketed-day lists (`pre_mark_retention_option_days` under smoothed, `pre_coverage_option_days` under mark-to-market) set a new local `_options_bucketed_days`; the caveat is `has_option_activity is True and (_options_basis_applied is None or _options_bucketed_days)`. The options basis still applies (`options_basis` is written), the matching meta key is stamped (185-08), and the persisted series is untouched, so a bucketed day keeps the return the ledger gave it (the cash ledger's own, when every day is bucketed) and nothing is interpolated or filled.
- **SC-3 as it now stands:** the flag is written exactly while a key's option days are measured at cash value (no options basis, a budget refusal, a timeout, a structural failure, or bucketed days) and is absent once the options basis fully applies.

## Task Commits

1. **Task 1** (decision, answered by the founder) - `ea7b21ff2` (docs): the SUMMARY answer line.
2. **Task 2 RED** - `681fac74d` (test): `red1.log`: 3 failed, 10 passed.
3. **Task 2 GREEN** - `a778f2b28` (feat): the budget slice, floor refusal and local timeout arm.
4. **Task 3 RED** - `4a16a01bf` (test): `red2.log`: 3 failed, 1 passed (the control case with no bucketed day passes by design).
5. **Task 3 GREEN** - `5c025c790` (feat): the F2 bucketed-day term in the caveat rule.

**Plan metadata:** the commit that adds this file (docs).

## RED evidence (semantic assessment)

- **Task 2** (`/tmp/deribitflowtime-09/red1.log`): `test_options_step_timeout_keeps_cash_and_the_caveat` failed because the derive wrote no `key_inputs` row (the timeout reached the cash pass's outer arm: log line "cash-pass crawl exceeded the 810.0s per-crawl bound ... classified transient, retrying"); `test_options_step_is_bounded_by_a_slice_of_the_remaining_budget` failed on its own "the bound must have cancelled this" after the hung assembler slept the full 30 s (unbounded); `test_options_step_below_the_floor_never_starts` failed "Expected mock to not have been awaited. Awaited 1 times." All three executed and failed on the planned assertion, not on an import, syntax or fixture fault. The two transient cases passed before the change as pins (185-08 already had the boundary); the neuter drill below proves they can fail.
- **Task 3** (`red2.log`): the two bucketed cases and the all-bucketed case failed on `assert None is True` for `payload.get("options_cash_basis")`, the planned assertion (185-08's rule cleared the flag whenever a basis applied). An earlier draft used a bare index and failed on a `KeyError`; it was rewritten to an assertion before the RED commit.

## Neuter drills (byte backup, restore, `cmp` each time)

| # | Neuter | Result |
|---|---|---|
| 1 | delete the local `except asyncio.TimeoutError` arm | `neuter1.log`: the timeout test and the bound test FAILED (2 failed). Restored, `cmp` clean against `job_worker.py.bak`. |
| 2 | add `DeribitTransientReadError` to the structural tuple | `neuter2.log`: the new transient test and 185-08's transient test FAILED. Restored, `cmp` clean against `.bak2`. |
| 2b (extra) | disable the floor check (`if False and ...`) | `neuter2b.log`: the below-floor test FAILED. Restored, `cmp` clean against `.bak2`. |
| 3 | drop the bucketed-day term from the caveat rule | `neuter3.log`: 3 FAILED (both bucketed cases and the all-bucketed case). Restored, `cmp` clean against `.bak3`. |

## Budget check against plan 185-02's dry run

The bound only helps if the options basis can finish inside it. `0.7 * (900 - crawl_s - cash_s)` against the measured options-step seconds (`dry-key:` lines):

- **Key A:** `crawl_s=109`, `cash_s=11`, `smoothed_s=83`, `mtm_s=11`, `pre_retention_days=0`, `pre_coverage_days=33`. Slice `0.7 * (900 - 120) = 546` s, against 83 s measured: covered with about 6.6x headroom. Under smoothed, key A has no retention-bucketed day (`pre_retention_days=0`), so its caveat clears under F2.
- **Key C:** `crawl_s=436`, `cash_s=27`, `mtm_s=28`, `smoothed_error=LedgerValuationError` (the smoothed attempt ends in 1 s on a structural error, `n_held=error:LedgerValuationError`). Slice `0.7 * (900 - 463) = 306` s, against 28 s for the mark-to-market comparison and 1 s for the smoothed refusal: the bound does not bind. Key C degrades to the cash ledger with the caveat by the 185-08 structural arm (D-10, "Smoothed, cash fallback"), not by this plan's budget, and its caveat will not clear until the replay refusal is fixed.
- Neither key triggers the plan's `## CHECKPOINT REACHED` condition (the options basis would not degrade every night on budget). The remaining budget in the real worker also loses the setup and the dense-marks read that `crawl_s` does not include, which is why the floor test shrinks the budget rather than trusting these figures to the second.

## Verification

- `python3 -m pytest tests/test_deribit_key_mode_options_basis.py tests/test_mtm_single_key.py tests/test_job_worker_deribit.py tests/test_job_worker_flipretry.py -q -p no:cacheprovider` (Task 2, system Python 3.14): **88 passed**. After Task 3 the new module plus `tests/test_options_cash_basis_caveat.py`: **22 passed**; the new module alone: **17 passed**.
- Full suite from `analytics-service/` with the repo venv: `.venv/bin/python -m pytest -n auto --dist loadgroup -q -p no:cacheprovider`: **14115 passed, 102 skipped, 0 failed** (185-08 recorded 14106 passed, 102 skipped; the difference is this plan's 9 new tests; no test was skipped by this plan).
- CI's mypy line, verbatim, with the venv's mypy, from `analytics-service/`: `Success: no issues found in 131 source files`.
- Acceptance greps: `grep -ac '_options_step_timeout' analytics-service/services/job_worker.py` printed 4 (needs at least 2; baseline 0). All three neuter-drill files restored byte-identically (`cmp` silent).

## Decisions Made

- F2 implemented as **f2-a**. The f2-b branch (go back to planning) and the f2-c branch (refuse the options basis for the whole key) are not implemented because those answers were not given.
- Timeout and below-floor refusal `break` out of the basis loop instead of `continue`. With the single F1 basis it is the same; with a future second basis it avoids a second chart crawl against a venue just measured too slow, and the budget only shrinks so a later basis would be refused anyway.
- The bucketed-day term does not switch on the basis name: the two lists are each populated only under their own basis (`deribit_ingest.py` comments at `pre_coverage_option_days` and `pre_mark_retention_option_days`), so an OR is exact and one less branch to drift.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's wording] The transient test asserts "leaves the job", not "returns FAILED"**
- **Found during:** Task 2 (RED)
- **Issue:** the plan's behavior says the assembler raising `DeribitTransientReadError` "returns a FAILED transient outcome". 185-08's existing test (and the observed behavior) is that the exception propagates out of `run_derive_broker_dailies_job`, which is how the dispatcher then classifies and retries it.
- **Fix:** `test_options_step_transient_still_retries` asserts the exception propagates (both classes) and that no `key_inputs` row was persisted, which is the property the plan states (retryable, no cash curve written on a blip).
- **Files modified:** `analytics-service/tests/test_deribit_key_mode_options_basis.py`
- **Commit:** `681fac74d`

**2. [Rule 3 - Blocking] Test harness needed two pass-throughs**
- **Found during:** Task 2 (RED)
- **Issue:** the harness `_run_derive` raised before returning its capture and had no way to add patches (budget, floor, combine recorder).
- **Fix:** `_run_derive` gained optional `extra_patches` (applied before the assembler patch, which stays last) and `capture_sink`. Existing callers are unchanged.
- **Files modified:** `analytics-service/tests/test_deribit_key_mode_options_basis.py`
- **Commit:** `681fac74d`

---

**Total deviations:** 2 auto-fixed (1 plan wording, 1 harness), both in test code. **Impact on plan:** none on shipped behavior.

## Issues Encountered

- The job_worker logger is named `quantalyze.analytics.job_worker`, not `services.job_worker`; the first RED draft filtered on the module path and found no records. The tests now use `job_worker.logger.name`.
- The key-mode meta stamps (`pre_mark_retention_option_dailies`, `pre_summary_rollout_option_dailies`) never reach the persisted `key_inputs` payload, so the F2 test observes them through a recording wrapper around the combine (the derive stamps that very dict in place). This is a property of 185-08's code, unchanged here; if the factsheet needs these stamps for a key, that is a later plan's job, and the caveat flag is what carries the message today.

## Known limits (recorded, not fixed)

- **The combine is not under the bound.** It runs on `asyncio.to_thread`, which cannot be cancelled; only the assembler (the chart requests and index marks) is. The plan asked for exactly this.
- **Key C stays on cash with the caveat** until its option-book replay refusal (`LedgerValuationError`) is fixed; that is plan 185-03's diagnosis and D-11's booked fix phase, not this plan.
- **A book with bucketed days keeps the caveat after PR-2** (the cost the founder accepted with f2-a).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema. The new log lines name the basis, the venue and budget seconds only; no amount, instrument or key id.

## PR-2 ship notes (for the CHANGELOG)

- The key-mode options step is bounded and degrades to cash with the caveat: it is cancelled at 0.7 of the remaining derive budget, refuses to start below 60 s, and on refusal or timeout keeps the cash ledger and the `options_cash_basis` caveat. It never fails the derive and never retries it; a transient read error from the step still propagates so the derive retries as before.
- Option days the options basis cannot value (older than the option-price window under the smoothed basis, or before the summary rollout under mark-to-market) follow the founder's F2 answer (D-07): they keep their cash-basis return, stamped, and nothing is interpolated. This departs from SC-5's "an uncomputable day is null" and SC-2's "values open options at market" for those days (ROADMAP correction note, D-07).
- The caveat stays exactly while any option day is at cash value, and clears per key once the options basis fully applies.
- PR-2 is plans 185-07 to 185-09; this is its last plan. No switch (F6 f6-a): rollback is reverting the merge.

## Next Phase Readiness

Plan 185-10 (the SC-3 and SC-4 reading on PROD after the next nightly derive, D-08) can start. PR-2 is complete in code.

## Self-Check: PASSED

- FOUND: `analytics-service/services/job_worker.py` (4 matches of `_options_step_timeout`) and `analytics-service/tests/test_deribit_key_mode_options_basis.py`.
- FOUND commits `ea7b21ff2`, `681fac74d`, `a778f2b28`, `4a16a01bf`, `5c025c790` (ancestors of HEAD); `git rev-list --count <plan_head_before>..HEAD` printed 5 before this file was rewritten.
- FOUND: exactly one well-formed `f2-answer:` line in this file.
