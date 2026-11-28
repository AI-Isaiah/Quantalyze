---
phase: 259-okxarchivefills-okx-fills-older-than-fills-history-s-3-month
plan: 06
subsystem: analytics-service / OKX archive fills job (the wait)
tags: [okx, archive, fills, compute_jobs, apply-budget, defer, rate-limit, mypy]

requires:
  - phase: 259-05
    provides: "`run_okx_archive_fills_job`, `_read_fills_status`, `plan_fill_quarters`, `_discover_targets`, `_read_fills_input`, the shared fakes"
provides:
  - "the GET-first wait: apply only on no entry (once) or `failed` (bounded), never on `ongoing` or `finished`"
  - "`_prior_applies`: the apply count persisted in the job's own result block and read back on the next claim (malformed reads as spent)"
  - "`_fills_defer`: result block first, then `defer_compute_job`; rate limits defer without stamping the key"
  - "named arms for the wait, apply budget, leak rule, target filter, quarter plan and input contract"
affects: [259-07, 259-08, 259-09]

status: complete
commits: 3
plan_head_before: 10b4c2c41c764ad3409c4d3760b080b4e873a30e
plan_head_after: 992e63f3607f3fa620a52d23e200bed4c2414527

actuals:
  tokens: 13000       # chars/4 over the added lines of the two changed files (52054 chars)
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "a persisted count seeded into every result entry before any stop or defer can replace the stored block whole"
    - "count raised before the POST so an apply that is rate limited still counts"
    - "defer, never sleep: the only sleep in a claim is the apply pacing"

key-files:
  created: []
  modified:
    - analytics-service/services/okx_archive_fills.py
    - analytics-service/tests/test_okx_archive_fills_job.py

key-decisions:
  - "An entry in the carried block with no `applies` key reads as spent, like a non-int one: every block this module writes carries the key, so its absence means the block is not ours to trust."
  - "`_prior_applies` takes the claim's quarters as a second argument so a block whose shape cannot be read at all marks every quarter spent (a dict keyed by quarter cannot otherwise say 'all')."
  - "`_fills_quarter_step` does not take the exchange: the status reading is already in hand, and the apply uses its own fresh client through the pacer."
  - "A no-entry apply whose answer says the file already exists waits `STATUS_POLL_INTERVAL_S`; otherwise it waits `FIRST_STATUS_READ_AFTER_S` less the answer's age (the poll interval when that age already passed the first-read mark, `FIRST_STATUS_READ_AFTER_S` when the ts is unreadable)."
  - "Only `RateLimitExceeded` and `DDoSProtection` defer; any other `OperationFailed` from an apply propagates to the dispatcher exactly as in the rebuild handler."

requirements-completed: [SC-3, SC-4]

coverage:
  - id: D1
    description: "A calibrate waits across three claims: no entry gives one apply per quarter, each alone on its own fresh client, then ongoing (no apply, count carried), then finished and DONE with zero writes"
    requirement: "SC-3"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_job.py::TestTracer::test_tracer_wait_across_claims"
        status: pass
  - id: D2
    description: "The apply budget cannot be exceeded: one apply on no entry over six claims, a bounded count on failed, three applies for three quarters over six claims, a malformed count reads as spent, and the count survives a rate-limited claim"
    requirement: "SC-3"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_job.py::TestApplyBudget"
        status: pass
  - id: D3
    description: "A wait defers and never sleeps beyond apply pacing; a rate limit defers without stamping the key; drift, give-up and the backstop stop by name"
    requirement: "SC-4"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_job.py::TestWaitEdges"
        status: pass
  - id: D4
    description: "No link, request ts, amount, tradeId or balance reaches a progress write, defer reason, log line at DEBUG or error text"
    requirement: "SC-4"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_job.py::TestWaitEdges::test_no_link_ts_or_amount_leaks"
        status: pass
  - id: D5
    description: "Every quarter-plan branch, the target filter, the D-02 refusals and every input rule are pinned by a named arm"
    requirement: "SC-3"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_job.py::TestQuarterPlan"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_job.py::TestTargets"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_job.py::TestInput"
        status: pass
---

# Phase 259 Plan 06: The GET-first wait and its persisted apply count Summary

The fills job now waits on OKX instead of failing closed. A quarter's request state is read first and an archive request is made only when OKX has no entry (once per quarter per job) or reports `failed` (at most `FILLS_MAX_APPLIES_PER_QUARTER` in total). The count is persisted in the job's own result block and read back on the next claim, so a GET that keeps saying "no entry" can never become an apply loop. A waiting job is deferred, never slept.

## What was built

- **`_prior_applies(job, quarters)`**: reads `metadata.member_progress.quarters[*].applies`. Absent block or quarter means 0; a count that is not a non-negative int (bool, text, null, negative, missing key) means spent; a block whose shape cannot be read marks every quarter of the claim spent.
- **Seeding**: `_prepare` seeds each quarter entry's `applies` from the carried count right after the quarter plan and before `_allocator_key_preflight`. Every later result write (a stop or a defer before any quarter is stepped included) carries the counts, because `set_compute_job_progress` replaces the block whole.
- **`_fills_quarter_step(key_row, entry, reading, pacer, prior, job)`**: replaces plan 05's fail-closed branch. `finished` with a link is ready. `ongoing` or `finished` without a link waits `STATUS_POLL_INTERVAL_S` (unreadable ts is `archive_request_failed`, age at `GIVE_UP_AFTER_S` is `archive_give_up`) and never applies. `failed` applies while under the cap, counting before the POST. No entry applies once, then waits (`no_entry_after_apply` stop when the job itself reaches `GIVE_UP_AFTER_S`).
- **`_job_age_s`**, **`_Waiting`**, **`_fills_defer`**: the shortest wait of any quarter defers the job; the 24 h backstop is checked first so the stop path writes the block once; otherwise the block is written (best effort, cancellation never swallowed) and then `_defer_job` parks the row. Reasons are `okx_archive_rebuild: waiting fills quarters_ready=N/M` and `okx_archive_rebuild: waiting rate_limited`.
- **Rate limits** (`RateLimitExceeded`, `DDoSProtection`) anywhere in the handler's OKX calls, the apply POST included, defer `RATE_LIMIT_DEFER_S` and never stamp the key.
- **Tests** (`test_okx_archive_fills_job.py`, 73 arms in the module, was 25): the tracer, `TestApplyBudget`, `TestWaitEdges`, `TestTargets`, `TestInput`, and a rewritten `TestQuarterPlan` using the plan's arm names (plan 05's interim `test_status_other_than_finished_never_applies` is removed; plan 05's overlapping quarter-plan arms were renamed to the plan 06 names and strengthened, and the two non-overlapping ones kept).
- `okx_archive_job.py` is untouched by this plan (still one hunk against the phase base); no fakes were changed.

## Verification (measured)

- `pytest tests/test_okx_archive_fills_job.py`: 73 passed. With the pinned archive suites (fills map, parse, job, apply, rebuild, reconcile, download, main_worker): 971 passed.
- `make typecheck` (mypy strict): no issues in 149 source files.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK.
- The pinned test files are unchanged against the phase base; `git diff -U0 <base> -- analytics-service/services/okx_archive_job.py | grep -c '^@@'` prints 1.
- Local neuters (byte backup in the session scratchpad, restored with `cp`, proven with `cmp`; plan 08 does the formal version). Wait and budget: ongoing branch applies (tracer, both ongoing arms, three-quarter arm and the no-sleep arm RED); no carried count (RED); count not seeded (rate-limited-claim arm RED); count raised after the POST (rate-limited-apply arm RED); failed cap removed (RED); malformed count read as 0 (RED); link logged in the step (tracer, leak arm RED); sleep in the defer path (no-sleep arm RED); no-entry apply on every claim (persist, rate-limited arms RED); result block not written before the defer (tracer and wait arms RED). Targets and plan: archived filter, uid filter, connected filter, blank-uid stop, over_cap tags, quarter-not-over check, duplicate check, `pre_archive`, `unreachable`, `not_requested` spans and the cap each turn at least one named arm RED.

## Deviations from Plan

**1. [Process] RED-before-GREEN was not followed per task.** Task 1's code and tracer landed in one commit, and the Task 2 and 3 arms passed when first written because the behaviour was built in Task 1 (the plan's own "if an arm exposes a defect, fix the code" never triggered). The neuter checks above are the substitute evidence that each arm can fail.

**2. [Minor] `_prior_applies` has a second parameter** (`quarters`), and a carried entry with a missing `applies` key is read as spent (see key-decisions). The plan's one-argument signature could not express "the whole block is unreadable".

**3. [Minor] `_fills_quarter_step` does not take the exchange** (unused: the status is already read).

**4. [Minor] Extra arms beyond the plan**: `test_apply_budget_rate_limited_apply_still_counts` (the count-before-POST claim), `test_apply_budget_unreadable_block_marks_every_quarter_spent`, `test_ongoing_without_a_readable_ts_is_archive_request_failed`, `test_plan_quarters_over_cap_tags_reach_the_result`, `test_unknown_metadata_key_is_accepted`, and the two plan-05 arms kept (`anchor_inside_reach`, `no_anchor`).

No code defect in plan 05's `_discover_targets`, `plan_fill_quarters` or `_read_fills_input` was exposed; none was changed.

## Notes for plans 07 and 08

- The write seam is still the comment `Plan 07 writes here` before the final `info.outcome` assignment. A `fills_apply` job that gets there has every quarter finished; a quarter that waits returns before the seam, so the write only ever runs on a fully read job.
- Neuter targets by name: `test_apply_budget_zero_applies_when_finished`, `test_apply_budget_zero_applies_when_ongoing`, `test_apply_budget_no_entry_persists_never_reapplies`, `test_apply_budget_three_quarters_six_claims`, `test_wait_never_sleeps_in_claim`, `test_no_link_ts_or_amount_leaks`, `test_targets_same_account_connected_only`, `test_uid_mismatch_and_read_only`.
- A non-rate-limit `OperationFailed` from an apply POST propagates without a result write, so a count raised for it is lost; the next claim then reads GET first (which shows the request when OKX registered it), and the dispatcher's `max_attempts` bounds the rest. Same as the rebuild handler.

## Known Stubs

None.

## Threat Flags

None. T-259-13 (apply-budget exhaustion) and T-259-15 (link, ts, amount or tradeId in a log or result) are mitigated as planned and pinned by arms.

## Commits

- `f42b9b06d` feat(259-06): GET-first wait with a persisted apply count replaces the fail-closed branch
- `e5a10cc76` test(259-06): apply budget, drift, give-up, backstop, rate limits, no-sleep and leak arms
- `992e63f36` test(259-06): targets, D-02 refusals, quarter plan spans and input arms

## Self-Check: PASSED

- FOUND: analytics-service/services/okx_archive_fills.py (`def _prior_applies(`), analytics-service/tests/test_okx_archive_fills_job.py
- FOUND commits f42b9b06d, e5a10cc76, 992e63f36 (ancestors of HEAD; `git rev-list --count 10b4c2c41..HEAD` printed 3 before this file was added)
