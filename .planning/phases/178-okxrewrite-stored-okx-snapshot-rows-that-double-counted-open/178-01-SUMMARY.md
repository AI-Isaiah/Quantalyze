---
phase: 178-okxrewrite-stored-okx-snapshot-rows-that-double-counted-open
plan: 01
subsystem: analytics-service
tags: [equity-reconstruction, forced-rebuild, allocator, okx, bybit, probe]
status: complete

requires:
  - phase: 167.2.1.1.2
    provides: the whole-account forced rebuild and its closed refusal vocabulary
provides:
  - "_select_account_crawl_keys skips and counts an exchange account with no working key (any venue) instead of refusing the allocator"
  - "completion audit key account_non_working_accounts_excluded and probe record key non_working_accounts_excluded"
affects: [178-02, 178-03, 178-04, 178-05]

actuals:
  tokens: 7786
  tasks: 2
  commits: 2
plan_head_before: e89a6192c73b5525d3819804faaeb1332d9f3d81
plan_head_after: ca25a4c47af3621ee80a36cf34a4db804e58a14e

tech-stack:
  added: []
  patterns:
    - "a dead key never decides an exchange account's venue; the deciding venues are the working members' (every member's only when none works)"

key-files:
  created: []
  modified:
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/scripts/allocator_history_probe.py
    - analytics-service/tests/test_reconstruct_whole_account.py
    - analytics-service/tests/test_allocator_history_probe.py

key-decisions:
  - "D-05 (founder 2026-10-28): a dead key is relevant only to its own exchange account; the rebuild skips and counts it"
  - "Decision order per group: $0 Deribit, dead, two working venues, unsupported working venue; account_key_not_working only when no exchange account is left"

requirements-completed: [D-05, SC-2]
---

# Phase 178 Plan 01: A dead exchange account is skipped and counted, not a whole-account refusal (D-05)

**`_select_account_crawl_keys` now skips and counts any exchange account with no working key, on any venue, and refuses `account_key_not_working` only when no exchange account is left; the count reaches the completion audit and the probe record.**

## Accomplishments

- Root cause fixed at its one production site. The forced crawl (`_crawl_whole_account`) and the probe (`_probe_account`) both call `_select_account_crawl_keys`, so both are fixed together. Before: the loop read every member's venue before asking whether any member could sign in, then raised `account_key_not_working` for any one dead group, so one revoked Bybit key refused the owner's whole allocator including a working OKX account.
- Per-group decision order is now: (1) every deciding venue is Deribit, count it as $0; (2) no working member, skip and count (`non_working_excluded`); (3) working members on two venues, `account_key_venue_unsupported`; (4) one working venue outside `_ACCOUNT_REBUILD_VENUES`, `account_key_venue_unsupported`. The deciding venues are the group's working members' (every member's only when none works).
- After the loop, and before the identity check: an empty selection with at least one dead account raises `account_key_not_working` as its own literal statement. The later empty-selection raise keeps `account_sum_empty`.
- Third return value threads through three surfaces with one spelling each: `_AccountCrawl.non_working_accounts_excluded`, completion audit key `account_non_working_accounts_excluded` (beside `account_zero_contribution_accounts`, counts only), probe record key `non_working_accounts_excluded` (declared in `ACCOUNT_RECORD_KEYS`, `_ACCOUNT_VALIDATORS` with `_is_count`, defaulted to 0 in `_account_record`, set in `_probe_account`).
- Literal raise statements per token are unchanged from HEAD: `account_key_venue_unsupported` 2, `account_key_not_working` 1 (counted with `git grep -o`). The closed-set pin `test_forced_rebuild_refusal_reasons_are_a_closed_set` is green and untouched. A WORKING sfox, kraken or cross-venue marker group still refuses `account_key_venue_unsupported` (`test_select_refuses_an_exchange_account_no_rebuild_can_read`, unchanged, 3 passed).
- Left unchanged on purpose: `FORCED_REBUILD_REFUSAL_REASONS`, `account_groups`, `working_holder_predicate`, `identity_pending_venues`, `_account_rebuild_window`, `_account_marker_key_ids`, `choose_job_key`, `account_key_ids` (every key, so `account_key_count` still equals the census `keys_total`). `_account_rebuild_window` sees only the crawled keys, so a dead OKX group does not force the 90-day window (job test asserts `window_days` 730). `_account_marker_key_ids` still stamps every active non-Deribit key of a rebuilt account, so an active dead sibling is stamped (job test pins it).
- Tests: new `test_a_dead_exchange_account_is_skipped_and_counted` (3 job-level params: dead-bybit-revoked, dead-okx-error, dead-sfox-revoked), `test_a_revoked_bybit_key_leaves_the_owners_okx_account_readable` (probe), `test_select_a_dead_key_never_decides_the_venue_check` (5 params), `test_select_refuses_an_allocator_with_no_working_exchange_account` (7 params), `test_select_counts_two_dead_keys_of_one_exchange_account_once`, `test_select_a_dead_exchange_account_does_not_preempt_identity_pending`; the five-param refusal pin is inverted to `test_select_skips_and_counts_an_exchange_account_with_no_working_key`; five selection tests unpack three values and assert `excluded == 0`; the `only-key-revoked` param is removed from the venue-refusal job test (the new job test proves the opposite outcome for that book).

## Gates

- `python3 -m pytest tests/test_reconstruct_whole_account.py tests/test_allocator_history_probe.py tests/test_reconstruct_force_rebuild.py -q`: 260 passed (HEAD baseline 243).
- Filtered new/inverted set: 14 passed after Task 1, 23 passed after Task 2.
- CI's mypy line verbatim from `analytics-service/`: `Success: no issues found in 130 source files`.
- Full suite from `analytics-service/`: 13762 passed, 102 skipped, 1 deselected. The deselected file is `tests/test_xdist_group_is_real.py`, which fails in this checkout for an environment reason unrelated to this plan (pytest-xdist is not installed locally: `unrecognized arguments: -n --dist`); it was not run against HEAD before the change either, since it spawns a subprocess with xdist flags.

## RED proof

Task 1, before any production edit, on HEAD (`e89a6192c`), 9 failed, 209 deselected:

```
FAILED tests/test_reconstruct_whole_account.py::test_select_a_dead_key_never_decides_the_venue_check[dead-sfox]
FAILED tests/test_reconstruct_whole_account.py::test_select_a_dead_key_never_decides_the_venue_check[dead-unknown-venue]
FAILED tests/test_reconstruct_whole_account.py::test_select_a_dead_key_never_decides_the_venue_check[dead-cross-venue-group]
FAILED tests/test_reconstruct_whole_account.py::test_select_a_dead_key_never_decides_the_venue_check[dead-member-on-another-venue]
FAILED tests/test_reconstruct_whole_account.py::test_select_a_dead_key_never_decides_the_venue_check[dead-member-beside-a-working-deribit]
FAILED tests/test_reconstruct_whole_account.py::test_a_dead_exchange_account_is_skipped_and_counted[dead-bybit-revoked]
FAILED tests/test_reconstruct_whole_account.py::test_a_dead_exchange_account_is_skipped_and_counted[dead-okx-error]
FAILED tests/test_reconstruct_whole_account.py::test_a_dead_exchange_account_is_skipped_and_counted[dead-sfox-revoked]
FAILED tests/test_allocator_history_probe.py::test_a_revoked_bybit_key_leaves_the_owners_okx_account_readable
```

Failure reasons, as the assertions printed them: the five venue params raised `ForcedRebuildRefusedError: forced rebuild refused (account_key_venue_unsupported)` (two raise sites, mixed-venue and unsupported-venue); the job params `dead-bybit-revoked` and `dead-okx-error` ended FAILED with `forced rebuild refused (account_key_not_working)` where DONE was asserted; `dead-sfox-revoked` ended FAILED with `forced rebuild refused (account_key_venue_unsupported)`; the probe test read `assert 'account_key_not_working' == 'ok'`. The inverted five-param test and the Task 2 tests could not be run on HEAD as written (they unpack a third value or were added after the fix); they are covered by the neuter below. Each failure is the planned token on the planned assertion, not a collection, fixture or syntax error (semantic assessment: RED for the intended reason).

Task 2, byte-backup neuter. `equity_reconstruction.py` was copied with `cp -p` to a scratch directory outside the repo, then ONLY the per-group loop body of `_select_account_crawl_keys` was replaced by the loop body of the plan's base commit (verified equal to the base loop by string comparison); the three-value return and the post-loop all-dead raise were kept. The filtered run (7 name filters, all new and inverted tests) reported `17 failed, 6 passed, 203 deselected`:

```
FAILED ...::test_select_a_dead_key_never_decides_the_venue_check[dead-sfox] ... [dead-unknown-venue] ... [dead-cross-venue-group] ... [dead-member-on-another-venue] ... [dead-member-beside-a-working-deribit]   (5)
FAILED ...::test_select_skips_and_counts_an_exchange_account_with_no_working_key[inactive] ... [disconnected] ... [revoked] ... [sign-in-failed] ... [error]   (5)
FAILED ...::test_select_refuses_an_allocator_with_no_working_exchange_account[revoked-sfox-only]
FAILED ...::test_select_counts_two_dead_keys_of_one_exchange_account_once
FAILED ...::test_select_a_dead_exchange_account_does_not_preempt_identity_pending
FAILED ...::test_a_dead_exchange_account_is_skipped_and_counted[dead-bybit-revoked] ... [dead-okx-error] ... [dead-sfox-revoked]   (3)
FAILED tests/test_allocator_history_probe.py::test_a_revoked_bybit_key_leaves_the_owners_okx_account_readable
```

The 6 that passed are the six all-dead params of `test_select_refuses_an_allocator_with_no_working_exchange_account` (inactive, disconnected, revoked, sign-in-failed, error, revoked-beside-deribit), which pin both versions by design.

Restore: `cp -p` from the backup, then `cmp` of the module and the backup exited 0 and `git diff --quiet -- analytics-service/services/equity_reconstruction.py` exited 0. The same filtered run then reported `23 passed, 203 deselected`. The scratch directory was deleted and confirmed gone. No `git checkout`, `git restore` or `git stash` was used.

## D-05 site audit

Question for every site: after the fix, can one dead key refuse or block the allocator here? Answer: no site does. Greps were run at the post-fix tree.

(a) The five `raise ForcedRebuildRefusedError(` statements inside `_select_account_crawl_keys`:

| Token | Condition | One dead key can raise it? | Pinned by |
|---|---|---|---|
| `account_key_venue_unsupported` (1) | the group's WORKING members sit on more than one venue | No: a dead member is outside `working`; with no working member the group is skipped first | `test_select_refuses_an_exchange_account_no_rebuild_can_read[bybit-okx-group]` (working pair, still refuses); `test_select_a_dead_key_never_decides_the_venue_check[dead-member-on-another-venue, dead-cross-venue-group]` |
| `account_key_venue_unsupported` (2) | the one WORKING venue is outside `_ACCOUNT_REBUILD_VENUES` | No: a dead sfox or unknown-venue key has no working member and is skipped and counted | `..._no_rebuild_can_read[sfox, kraken]` (working, still refuse); `..._never_decides_the_venue_check[dead-sfox, dead-unknown-venue]`; job `dead-sfox-revoked` |
| `account_key_not_working` | selection empty and at least one dead account skipped (no exchange account left to crawl) | Only when EVERY non-Deribit exchange account is dead: that is the all-dead allocator, not one dead key | `test_select_refuses_an_allocator_with_no_working_exchange_account` (7 params) |
| `account_identity_pending` | two unstamped working keys on one stamping venue (counts working keys only) | No | `..._identity_pending` and `test_select_a_dead_exchange_account_does_not_preempt_identity_pending` |
| `account_sum_empty` | selection empty with no dead account (Deribit-only book) | No | existing Deribit-only coverage; unchanged |

(b) Hits of `working_holder_predicate|eligible_key_predicate|NOT_WORKING_SYNC_STATUSES|identity_pending_venues` in the two modules, by enclosing function:

- `_select_account_crawl_keys` (the `working` list, and the post-loop `identity_pending_venues`): fixed, see (a).
- `_fetch_latest_holdings_per_eligible_key` (daily refresh) and its helpers `_over_age_account_holds`, `_identity_unknown_and_not_working`, `_refresh_hold_reason`, and the `_LatestHoldings` fields: a group with no eligible key is skipped (`if not eligible: continue`); `never_polled_working`, `price_gap` and the over-age hold fire only when an eligible key is WORKING, a dead account lands in `never_polled_failing`, `no_working` or `identity_unknown_not_carried` and never holds the day; `identity_pending_venues` counts working keys only. Not the forced path, and no dead key blocks it.
- `choose_job_key` in the probe (`allocator_history_probe.py`): picks the earliest working Bybit, else working OKX, key; falls back to the first row only when none works. It never blocks.
- The probe's import of `working_holder_predicate`: the same helper, no gate.

(c) `ForcedRebuildRefusedError("...")` outside the selection, and whether a key's status alone can trigger it:

- `history_days_unreproduced` (window replace refusal): decided by the SQL from stored days versus the payload days; dropping a dead account removes a constraint on the shared-day intersection, so the rebuilt set can only grow. Key status is not an input.
- `positions_unreadable` (several raises): per selected, working key's positions read; a venue reply, not a key status.
- `account_state_unreadable`: the `api_keys` read failed or does not contain the job's own key; a read fault, not a key status.
- `account_key_no_rows`, `account_key_read_failed`, `account_key_read_stalled`: raised for a SELECTED (working) member's read; a skipped dead key is never read.
- `account_sum_empty` (second raise, after the crawl): the sum had no shared day; unrelated to status.
- `account_keys_changed`: compares key id sets before and after the crawl, ids only.

(d) `_allocator_key_preflight` in `services/job_worker.py`: for the job's OWN key it fails permanently only when the row is missing or `is_active` is false, then runs the circuit breaker, decrypts and builds a client (no network call); it never looks at `sync_status`. Not a D-05 block: the job key is picked by the operator or by `choose_job_key`, which prefer a working key, and `_crawl_whole_account` preflights only the SELECTED siblings, never a skipped dead one. One caveat recorded for plans 04 and 05: if an operator queued the job on a dead (but active) key, that one key would still be decrypted by the handler's own preflight; the runbook enqueue form must keep choosing a working key.

(e) `git grep -n 'account_key_not_working'` over the services, routers, scripts, `src` and `supabase/migrations` paths: three hits, all in `services/equity_reconstruction.py`: the `FORCED_REBUILD_ACCOUNT_REASONS` member (vocabulary unchanged), the selection docstring, and the single all-dead raise. No hit in `src`, `routers`, `scripts` or any migration. Outside those paths: `docs/runbooks/marksource-okx-history-correction.md` lines naming the token and `TODOS.md` entries (one citing the renamed test `test_select_refuses_an_exchange_account_w...`); those describe the old behaviour and belong to plan 05 and the ship step, not to this code plan.

Conclusion: no site still refuses or blocks an allocator on one dead key.

## Deviations from Plan

None - plan executed as written. Two notes on form, not substance:

- The plan is `type: execute` (tracer-first), so RED was proven by running the new tests on HEAD before the production edit and by the byte-backup neuter, and Task 1 is one commit carrying tests and fix, as the plan specifies, rather than separate `test(...)`/`feat(...)` commits.
- `SEQUENTIAL=true` was applied to the commit guard (linked phase worktree on `feat/178-okxrewrite`).

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path, file access or schema; the new audit and probe keys are integer counts inside the existing counts-only blocks.

## Issues Encountered / Follow-ups for others

- `tests/test_xdist_group_is_real.py` fails locally for lack of pytest-xdist (environment); not caused by this plan, CI installs it.
- `docs/runbooks/marksource-okx-history-correction.md` (the line stating an exchange account with no working key refuses `account_key_not_working`, and the token list near line 612) and `TODOS.md` (the entry citing `test_select_refuses_an_exchange_account_with_no_working_key`) are now stale. Plan 05 owns the runbook; the TODOS pointer is for the ship step.
- Cross-plan contract for plan 02 (P7) and plan 05 (B'5): the audit literal is `account_non_working_accounts_excluded`, counted per exchange account (a group of two dead keys counts once), with the precedence $0 Deribit, dead, two working venues, unsupported working venue.
- A dead member on another venue than its group's working key is NOT counted dead (its exchange account is crawled through the working key); P7 must count that member's holdings against the window (D-06).

## Self-Check: PASSED

- Files: `analytics-service/services/equity_reconstruction.py`, `analytics-service/scripts/allocator_history_probe.py`, `analytics-service/tests/test_reconstruct_whole_account.py`, `analytics-service/tests/test_allocator_history_probe.py` all FOUND; each of the four carries its change in `git diff e89a6192c..HEAD --stat`.
- Commits: `3e66e7e7a` (fix) and `ca25a4c47` (test) are ancestors of HEAD; `git rev-list --count` from the recorded base reports 2.
- STATE.md and ROADMAP.md untouched.
