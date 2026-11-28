# Phase 259: Code Review Fix Report

**Source review:** `259-REVIEW.md` (round 1, "Orchestrator dispositions for the fixer round")
**Iteration:** 1

## Fix round 1 topic A (apply budget and wait)

**Files modified:** `analytics-service/services/okx_archive_fills.py`,
`analytics-service/tests/test_okx_archive_fills_job.py`, `docs/runbooks/okxarchivefills-backfill.md`
**Verification ran in:** the phase worktree (`gsd/phase-okxarchive`), main checkout of that branch, no
temporary worktree. `pytest` on the six okx_archive test files: 538 passed. `make typecheck` (mypy
strict): no issues in 149 files.

### CR M-01 + SFH-M1 + SFH-M2: fixed (requires human verification: control-flow change on the apply path)

The apply count is now write-ahead. `_counted_apply` raises `entry["applies"]`, stores the whole
result block through `_write_result` (`_persist_apply_count`), and only then POSTs through the pacer.
If the store raises, or is a fenced no-op (claim token lost), no POST is made and the claim ends with
the new transient class `fills_count_not_persisted`, added to `FILLS_STOP_CLASSES` and
`FILLS_TRANSIENT_STOP_CLASSES` (the closed-set test is updated). A timeout or any other unknown
outcome on the POST stays counted as spent, and now stays counted on the next claim too.

Tests (`TestApplyBudget`): `test_apply_count_is_stored_before_the_post` (timeout on the POST, count
already stored at POST time, next claim does not apply again),
`test_apply_is_not_posted_when_the_count_cannot_be_stored[raises|fenced_no_op]`,
`test_fills_stop_classes_closed`. RED on the pre-fix source and on a copy with only the persist call
removed; GREEN after restore (byte-compared with `cmp`).

### SFH-M3: fixed (requires human verification)

On `RateLimitExceeded`/`DDoSProtection` from the apply POST, `_counted_apply` restores
`entry["applies"] = prior`, stores the block again, and re-raises so the handler defers. Timeouts and
unknown outcomes are not touched. The old arm `test_apply_budget_rate_limited_apply_still_counts`
encoded the behaviour this disposition reverses; it is replaced by
`test_apply_budget_rate_limited_apply_gives_the_count_back` (stored count is 0 after the refusal, the
next claim applies). RED with the restore removed from a copy.

### CR M-03: fixed (requires human verification)

In `_read_and_gate`'s download loop, a `link_expired` stop that is not `cause=network` (that is,
`expired_twice` or `no_fresh_link`, after `_download_quarter`'s one fresh GET) now triggers one
counted, stored apply (`_counted_apply`, on its own fresh client through the pacer, the last call on
that client) when `entry["applies"] < FILLS_MAX_APPLIES_PER_QUARTER`. The claim then defers:
`FIRST_STATUS_READ_AFTER_S` if OKX generates anew, `STATUS_POLL_INTERVAL_S` if it answered "already
exists" (clamped by the defer ceiling). A spent quarter keeps the transient `link_expired`.
The module docstring (wait paragraph and the `259-ARCHIVE-QUARTER-CAP` paragraph) and runbook
sections 9, 10 and 14 no longer claim "no apply while OKX still holds the files" or "within 5.5 h so
no re-apply is needed"; they state the dead-link re-apply and its cost.

Tests: `test_dead_link_on_a_finished_quarter_reapplies_once_counted` (two applies at most over six
claims, then `link_expired`), `test_dead_link_reapply_is_stored_before_the_post_and_then_reads`
(re-apply, then DONE), `test_download_network_failure_is_not_a_dead_link` (no apply on a transport
failure). RED with the dead-link branch disabled in a copy.

### Notes for the round

- One commit covers all three items: they share `_counted_apply` and the same test class, so a
  per-finding split would need hunk-level staging, which this environment does not support.
- Not touched (topic B): write order, cooldown, labels, inserted counts.
- LOW items stay recorded only. L-04 ("at most twice ever" is per job) is still in runbook section 1.

## Fix round 1 topic B (write path, cooldown, labels)

**Files modified:** `analytics-service/services/okx_archive_fills.py`,
`analytics-service/services/okx_archive_fills_chain.py`,
`analytics-service/tests/test_okx_archive_fills_apply.py`,
`analytics-service/tests/test_okx_archive_fills_chain.py`,
`analytics-service/tests/test_okx_archive_fills_job.py`, `docs/runbooks/okxarchivefills-backfill.md`
**Verification ran in:** the phase worktree (`gsd/phase-okxarchive`), no temporary worktree. `pytest`
on the six okx_archive test files: 551 passed. `make typecheck` (mypy strict): no issues in 149 files.
RED proof: the fixed sources were copied aside, the HEAD versions put back, the three test files run
(15 failed, every new arm among them), the fixed copies put back and `cmp`-verified, then GREEN.

### CR M-02: fixed

`_write_fills` sorts each target's write rows newest first (by `row_ms`) before cutting batches of
100. A stopped write therefore leaves the OLDEST fills unwritten, so the chain's reach test (earliest
stored fill against the anchor) keeps answering "not reached" and the next chained read completes the
rest through the idempotent upsert. Test: `test_batches_are_written_newest_first`.

### SFH-M4 + CR L-02: fixed (requires human verification: cooldown predicate)

`_counts_toward_cooldown` counts a `failed_final` only when `last_error` starts with
`okx_archive_rebuild: ` and the class token after it is not in `_UNANSWERED_STOP_CLASSES`:
`invalid_input` plus the transient classes `claim_budget_exceeded`, `link_expired`,
`fills_write_failed`, `fills_count_not_persisted` and also `live_fetch_failed` (the rebuild's own
`TRANSIENT_STOP_CLASSES` carries it, and it too only reaches `failed_final` after its retries ran
out). The fills job imports the chain module, so the chain cannot import the transient sets; the
copy is bound by `test_cooldown_unanswered_classes_bind_the_job_sets` (equality with
`TRANSIENT_STOP_CLASSES | FILLS_TRANSIENT_STOP_CLASSES` plus `invalid_input`). A foreign
`last_error` or a bare prefix no longer counts. The chain docstring and runbook section 2 are updated.
Tests: `TestCooldown::test_cooldown_rules` (five exhausted transient classes, foreign prefix, bare
prefix re-chain; a permanent fills stop still cools down).

### SFH-M5: fixed (label only)

When the plan has no reconcile quarter, each target's reading is
`{"position": n, "state": "not_performed"}` instead of an empty `window_empty` comparison. The
recorded fail-open decision is unchanged (the write still proceeds for a proven instType with the bal
chain passing). `window_empty` stays for a reconcile quarter that was read and empty. Three existing
assertions were updated to the new label (their names too, where they said `window_empty`). Runbook:
state list and go/no-go line 5 name `not_performed`.

### SFH-M6: fixed

`inserted_before_failure` is `unknown` when any written target (position up to the failing one, state
`read`) has a None count. The failure log carries the exception class and, only when `code` fully
matches `[0-9A-Z]{5}`, `code=<SQLSTATE>`; message, details and hint are never logged. A `_Stop`
(claim budget) during the write sets that target's `inserted` to None before propagating. Runbook
section 1 describes the `unknown` reading. Tests: `test_failure_with_an_unreadable_count_says_unknown`,
`test_write_failure_logs_only_a_sqlstate_code` (a valid code logged, a free-text code and the
message/details not), `test_budget_running_out_mid_write_sets_the_count_unknown`.

### Notes

- Two commits, not one per finding: M-02, SFH-M5 and SFH-M6 all edit `_write_fills` and
  `okx_archive_fills.py`, so a per-finding split would need hunk-level staging.
- LOW items stay recorded only.

---

_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
