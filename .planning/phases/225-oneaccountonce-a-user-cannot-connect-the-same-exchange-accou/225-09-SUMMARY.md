---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 09
subsystem: analytics-identity
tags: [account-identity, stamper, swap-account-slot, mt5d-08, d-25, q1]
requires:
  - phase: 225-04
    provides: public.swap_account_slot (live on PROD, catalogue gate passed)
  - phase: 225-06
    provides: normalise_venue_server, same_venue_server, pick_same_account_holder (Python twins)
provides:
  - the daily poll's stamper moves a slot from a failing same-owner holder to a working key through swap_account_slot, audits the demoted key and recomposes
  - StampOutcome swapped_holder
  - a refused swap falls back to today's marker state with the token logged
affects: [225-12]
tech-stack:
  added: []
  patterns: [one synchronous thread task for a database write plus its audit plus its recompose enqueue]
key-files:
  created: []
  modified:
    - analytics-service/services/account_identity.py
    - analytics-service/tests/test_account_identity_stamper.py
key-decisions:
  - "A composite rotation is read BEFORE any swap (one _share_kind read, only when a swap is a candidate) and stays composite_member with no duplicate audit, even when the stamping key is working. The plan's wording left this to the RPC, but the RPC refuses only a composite_member DEPENDENT of the holder, not a holder and key that are members of one composite, so D-04 would have been broken."
  - "The stamping key's broker server is read from its own stored venue_server (normalised) and sent as p_venue_server only when non-null; plan 12 owns capturing it."
  - "The recompose enqueue became one helper, _enqueue_recompose, shared by the marker path and the swap path; the marker path's log text is byte-identical."
requirements-completed: [MT5D-08]
status: complete
actuals:
  tokens: 30000
  tasks: 2
  commits: 2
plan_head_before: 27f1de83e2b407da24909bfef73507c57c82e68a
plan_head_after: ff9fb400aad8bce6ed0eff64b0b39ade79f992f5
---

# Phase 225 Plan 09: The poll's stamper takes a slot from a failing holder Summary

A working key whose stamp the identity index refuses now takes the account's slot from a same-owner holder that is not working (D-18), through the one `swap_account_slot` function, audited and recomposed; a swap the database refuses leaves today's marked state.

## What was built

- **Task 1 (tracer), commit 5b4bd43f7.** `_find_live_holder` now selects id, venue_server, is_active, sync_status, disconnected_at, account_shared_with_api_key_id and account_share_kind, keeps the owner, venue, login, live and not-self filters, orders by id with no limit, and returns `pick_same_account_holder(rows, server, after_index_refusal=True)`. New `_settle_with_holder` swaps only when `working_holder_predicate(key)` is true and `working_holder_predicate(holder)` is false (imported from `allocator_equity_derive`, never copied). New `_swap_slot_and_audit` is one synchronous thread task through `db_execute`: the RPC, then `_audit_duplicate` on the demoted holder naming the stamped key as its holder, then the recompose enqueue. `StampOutcome` gains `swapped_holder`. The two collision test doubles now return a full WORKING holder row (`_holder_row`), so every pre-existing case keeps its meaning. The fake's `_Call` records the selected columns.
- **Task 2, commit ff9fb400a.** An `APIError` whose message starts with `ACCOUNT_SLOT_` is absorbed inside `_swap_slot_and_audit`; the caller logs WARNING with the matched token only and falls back to `_mark_shared`. Any other swap error propagates to the boundary as before. The 167.1.2 pin `test_a_revoked_holder_does_not_self_heal_its_duplicate` is replaced by `test_a_working_duplicate_takes_the_slot_from_its_revoked_holder`, with a dated note quoting D-25 (founder 2026-10-11, "Fix") and Q1 (founder 2026-11-23, "Admit working key"). `stamp_account_identity`'s docstring and the section header comment describe the new outcome, the fallback and the RPC as a writer.

## Verification

- `pytest tests/test_account_identity_stamper.py tests/test_account_identity.py tests/test_venue_server_identity.py`: 238 passed. Wider set (every test file that names account_identity, plus `test_derive_allocator_equity_job.py`): 869 passed.
- mypy line: `Success: no issues found in 142 source files` (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`, from `analytics-service/`).
- `ruff check` on both touched files: `All checks passed!`

## PROOF-01 record (neuter, RED, byte restore, GREEN)

Backup: `cp analytics-service/services/account_identity.py <scratchpad>/account_identity.py.bak`; each neuter restored with `cp` and checked with `cmp` (silent). No git checkout, restore or stash.

- **Neuter A**, `_settle_with_holder` always marks (`if True:` in place of the working-key/failing-holder condition). RED, `8 failed, 133 passed`, the tracer first: `FAILED ...::test_a_working_key_takes_the_slot_from_the_owners_failing_holder`, `...::test_a_working_duplicate_takes_the_slot_from_its_revoked_holder`, `...::test_a_refused_swap_marks_the_key_as_today_and_logs_only_the_token[ACCOUNT_SLOT_HOLDER_WORKING]` (and the three other tokens), `...::test_a_swap_error_that_is_not_a_refusal_is_not_swallowed`, `...::test_the_server_of_the_stamping_key_reaches_the_swap`. `cmp` silent. GREEN: `141 passed`.
- **Neuter D**, the `ACCOUNT_SLOT_` fallback removed (the except clause re-raises unconditionally). RED, `4 failed, 137 passed`: `FAILED ...::test_a_refused_swap_marks_the_key_as_today_and_logs_only_the_token[ACCOUNT_SLOT_HOLDER_WORKING]`, `[ACCOUNT_SLOT_COMPOSITE_DEPENDENT]`, `[ACCOUNT_SLOT_NEW_KEY_NOT_WORKING]`, `[ACCOUNT_SLOT_IDENTITY_MISMATCH]`; the boundary logged `outcome=error class=APIError code=55000 message=ACCOUNT_SLOT_HOLDER_WORKING`. `cmp` silent. GREEN: `141 passed`.
- **Neuter E** (added), the composite pre-read removed. RED, `1 failed, 140 passed`: `FAILED ...::test_a_composite_rotation_beside_a_failing_holder_stays_composite_member[complete]`. `cmp` silent. GREEN: `238 passed` (three files).
- **Neuter F** (added, T-225-28), the `.eq("user_id", ...)` line removed from the holder read. RED, `3 failed, 138 passed`: `FAILED ...::test_a_working_key_takes_the_slot_from_the_owners_failing_holder`, `...::test_collision_with_a_live_sibling_marks_the_key_and_never_acts_on_it`, `...::test_mt5_collision_marks_the_key_duplicate_and_audits_once`. `cmp` silent. GREEN: `238 passed`.

The Task 2 behaviour tests were written first and ran RED against the Task 1 code (5 failed, 6 passed) before the fallback and the composite pre-read were implemented.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A composite rotation beside a failing holder would have been swapped**
- **Found during:** Task 2 (the composite behaviour test went RED against Task 1's code: `assert 'swapped_holder' == 'marked_composite_member'`).
- **Issue:** The plan relies on the RPC refusing composite dependents. The RPC refuses only when a `composite_member` row is marked AGAINST the old holder. Two members of one composite with disjoint windows (a key rotation) are not yet marked, so a working stamping key beside a failing holder would have been swapped, the holder marked `duplicate` and audited as one. That breaks D-04 and truth 4.
- **Fix:** `_settle_with_holder` reads `_share_kind` before a swap; anything but `duplicate` goes to `_mark_shared` (given the kind, so there is no second read). The extra read happens only when a swap is a candidate.
- **Files modified:** analytics-service/services/account_identity.py, analytics-service/tests/test_account_identity_stamper.py
- **Commit:** ff9fb400a

**2. [Rule 3 - Blocking] Test double: swap-only error hook**
- `FakeSupabase.rpc_error` raises for every RPC, which would have hit the fallback marker's recompose enqueue too. Added `swap_error`, raised for `swap_account_slot` only. Existing `rpc_error` users are untouched.

No `<threat_model>` mitigation was skipped: T-225-27 (swap only for a working key, the RPC re-checks; pinned by Neuter A and the failing-key test), T-225-28 (owner filter asserted in the tracer test; pinned by Neuter F).

## Known limits

- **A holder with a composite_member dependent is never swapped.** The RPC refuses it (`ACCOUNT_SLOT_COMPOSITE_DEPENDENT`; composites are out of scope by F-2 / Q4), so the stamper falls back to marking the working key `duplicate`, which is today's state.
- A failing key with NO same-owner sibling on its account still stamps (there is no working key to hand the slot to); it gives the slot up on the first poll of a working sibling.
- A swap error that is not an `ACCOUNT_SLOT_` refusal (for example a `55P03` lock timeout) is an `error` outcome at ERROR, as any unrecognised failure is; it was not added to the retryable set (out of plan scope).
- A swap that moves an MT5 failing holder's `venue_account_id` to NULL touches what 155.2's `report_account_matches` hashes, so the 155.2 freeze binds PR-2 (the orchestrator re-checks it before PR-2 opens and again before it merges).

## Ship notes for PR-2

- The ship deletes the `TODOS.md` entry `[167.1.2-MT5-FAILING-HOLDER]` and names it in the CHANGELOG entry.
- Plan 12 edits the same two files next (MT5 server capture and backfill, the cross-owner stamping pin, the gate-A5 census runbook).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; the poll calls the existing service-role RPC.

## Self-Check: PASSED

Files present: `analytics-service/services/account_identity.py`, `analytics-service/tests/test_account_identity_stamper.py`. Commits 5b4bd43f7 and ff9fb400a are ancestors of HEAD on `worktree-agent-225-09`. No STATE.md or ROADMAP.md change.
