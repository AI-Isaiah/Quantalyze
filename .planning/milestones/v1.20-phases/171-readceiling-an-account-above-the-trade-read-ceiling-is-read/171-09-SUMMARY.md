---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
plan: 09
subsystem: analytics-service
tags: [trade-read, forced-rebuild, whole-account-crawl, defer-compute-job, outcome-precedence]
status: complete

requires:
  - phase: 171-readceiling
    provides: "plan 07's resumable Bybit read, scope ContextVar and TradeReadDeferred handler arm; plan 08's stalled arm and job-age backstop"
provides:
  - "the forced whole-account rebuild reads a Bybit member across claims: one trade-read scope around the account crawl, each member's own key bound into a copy of it"
  - "deferral-last outcome precedence in _crawl_whole_account (a TradeReadDeferred is remembered, every other outcome decides first, then it is re-raised for the handler to defer the job)"
affects: [171-10, 171-12]

actuals:
  tokens: 5071
  tasks: 3
  commits: 2
commits: 2
plan_head_before: 8a5c0bcd18c5f36898fa6c482b2996077a3041ce
plan_head_after: 23d6bd79401fc4894c6d89afdc7875ec864952b9

tech-stack:
  added: []
  patterns:
    - "one ContextVar scope set before the gather, rebound per member inside the member's own task (asyncio.gather copies the context per coroutine)"
    - "a non-fatal outcome remembered across the key-order loop and decided last"

key-files:
  created: []
  modified:
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/tests/test_reconstruct_whole_account.py

key-decisions:
  - "deferral is decided LAST in _crawl_whole_account (planner decision, Rule 7): RESEARCH's proposed order (refusal > settled MT5 > deferral > retryable > permanent) was not adopted; today's key-order loop keeps every existing outcome and a deferral only wins when every other member settled cleanly"

requirements-completed: [SC-1]
---

# Phase 171 Plan 09: the forced account rebuild resumes a Bybit member's read across claims Summary

A forced whole-account rebuild of an a6-shaped account (a Bybit member plus other venues) whose Bybit read is too big for one claim now defers the whole job through `defer_compute_job` with nothing written, keeps the windows it read under that member's own key, and on the next claim finishes, replaces the window once and purges every member's store rows; a deferral never masks another member's refusal, permanent failure or retryable fault.

PLAN_BASE `8a5c0bcd18c5f36898fa6c482b2996077a3041ce`. `rev-list --count` over the plan: 2 (before this SUMMARY's own commit).

## What was built

- `services/equity_reconstruction.py`
  - Forced branch of `run_reconstruct_allocator_history_job`: a `store.TradeReadScope` with `api_key_id=None`, the claim deadline taken once, the job's id and `created_at`, built immediately before the account crawl; the existing `asyncio.wait_for(_crawl_whole_account(...))` is enclosed in `with store.trade_read_scope(...)`. The crawl call and its timeout are unchanged. The `TradeReadDeferred` arm plan 07 added (and the purge on DONE, which already covers `account.account_key_ids`) handles the rest; no handler arm was added or changed.
  - `_crawl_account_key`: for a non-MT5 member, when a scope is current, the unchanged `_fetch_and_price_window(..., require_anchor=True)` call runs inside `with store.trade_read_scope(dataclasses.replace(scope, api_key_id=str(key_row["id"])))`. No new keyword; signature, return and the rate-limit stamp unchanged; `test_unforced_reconstruct_calls_the_crawl_and_the_anchor_with_their_existing_arguments` still pins `{"require_anchor": True}`.
  - `_crawl_whole_account` outcome loop: an arm for `store.TradeReadDeferred` BEFORE the refusal / settled-MT5 / generic arms remembers the first deferral (and its member) and continues. After the loop, if one was remembered and nothing else decided, one counts-only WARNING (`reconstruct_allocator_history account crawl deferred allocator=%s key=%s venue=%s windows_done=%d windows_total=%d`) and the deferral is re-raised; the `finally` still closes every session this function opened. Docstrings of both functions state the rules and why.
  - `import dataclasses` added (module use `dataclasses.replace`).
- `tests/test_reconstruct_whole_account.py`: the tracer, one extra member-binding test, the four precedence tests (seven collected cases), and the helpers `_forced_claim_job`, `_resume_rig`, `_mt5_member`, `_store_key_ids`, `_defer_member`, `_run_forced_claim`. It imports plan 07's fake-clock helpers from `tests/test_trade_read_resume.py` (`_Clock`, `_big_book`, `_venue`, `_defer_calls`, `_store_rows`, `_DEFER_REASON`, `_JOB_ID`, `_WINDOWS`); the fake clocks include the wall clock, so `store._wall_ms` is patched as plan 08 required.

## Precedence decision

Recorded as the context block asked. RESEARCH proposed deciding over all outcomes first (refusal > settled MT5 result > deferral > retryable > permanent). This plan keeps today's key-order loop for every existing outcome and decides a deferral last. Reasons: no existing outcome or pinned test moves (Rule 3); a refusal and a permanent failure are deterministic, so deferring on them would only burn claims and never say why; the stored windows survive a FAILED claim, so a sibling's retryable fault ending the claim transient (one attempt) loses no read progress. A deferral reaching the generic arm would otherwise be classified unknown (drill S shows the exact text: "whole-account rebuild crawl hit an unclassified fault (TradeReadDeferred)").

## Evidence

Tracer `test_a_forced_account_whose_bybit_read_is_deferred_writes_nothing_then_completes`: key 1 is a Bybit account (the job's own key, `_big_book()` on the fake clock, claim budget 45 s), key 2 an MT5 account (the mixed-venue test's recording ledger fake). The plan's example sibling was a default Bybit exchange; an MT5 sibling was used so the store can only ever hold the Bybit member's rows (a second Bybit member would store windows too, depending on task interleaving, which would make the "job key only" assertion non-deterministic).

- Claim 1 (job id J, token T1): `DEFERRED`; RPC names in order: `defer_compute_job` only (one call, `p_claim_token` T1, a counts-only reason matching `trade read deferred (windows N/M, trades K)`); 41 windows stored, all under key 1; `_book_state(fake) == before`; no api_keys update; no `replace_allocator_*` RPC; no failure audit and no completion audit.
- Claim 2 (J, T2, budget 1e9): `DONE`; RPC names appended: `replace_allocator_equity_snapshots_window` exactly once (still one `defer_compute_job` call in total); no row left in either store table; completion audit with `account_rebuild` True and two exchange accounts.

RED first (`/tmp/readceiling-09/red.log` at PLAN_BASE code): `FAILED ...::test_a_forced_account_whose_bybit_read_is_deferred_writes_nothing_then_completes` with `DispatchResult(outcome=DONE)` where DEFERRED was expected (the forced path set no scope, so the whole read ran in one claim), not ERROR. `grep -ac 'account crawl deferred'` in the module: 0 before, 1 after.

Extra test `test_each_member_reads_under_its_own_key_not_the_jobs`: here the job's own key (key 1) is MT5 and the Bybit member is its sibling (key 2). Claim 1 defers with every store row under key 2 only; claim 2 completes in fewer venue requests than the windows still unread plus slack (64 requests against 105 windows with 41 kept), writes once and purges key 2's rows. This is what makes the binding observable: a binding to the job's key would file under key 1.

Task 2 (`red-task2.log`): all seven precedence cases already held after Task 1 (`7 passed`). That is expected and recorded: they pin the rule Task 1 wrote, so they are pins, not REDs; drills S and T below are what show them able to fail.

| Test | Held after Task 1? |
|------|--------------------|
| `test_precedence_a_sibling_refusal_beats_a_bybit_deferral_in_either_key_order` (2 cases) | yes, pin (drill T fails case 1) |
| `test_precedence_a_sibling_permanent_failure_beats_a_bybit_deferral` (2 cases) | yes, pin |
| `test_precedence_a_sibling_retryable_fault_beats_a_bybit_deferral` (2 cases) | yes, pin |
| `test_precedence_a_deferral_is_not_an_unknown_fault` | yes, pin (drill S fails it) |

The permanent and retryable tests are parametrized over both key orders (the deferring member first, then second), so "last" is exercised where the deferral comes before the sibling's outcome in the loop.

Gates: quick run `165 passed, 1 warning` at Task 1; `tests/test_reconstruct_whole_account.py` `80 passed`; selector `-k "precedence or deferred"` `8 passed`; full analytics suite `13011 passed, 99 skipped` (plan 08 reported 13002 passed, 99 skipped; the nine new passes are this plan's tests; none of the 99 skips is from this plan); CI mypy line verbatim `Success: no issues found in 124 source files`.

Drills (file backed up byte for byte to the scratchpad, edited in place, test run, restored with `cp`, `cmp` exit 0 every time; never git checkout/restore/stash):

| Drill | Edit | FAILED line | cmp |
|-------|------|-------------|-----|
| S the deferral arm | arm made unreachable (`isinstance(outcome, ZeroDivisionError)`) | `FAILED ...::test_precedence_a_deferral_is_not_an_unknown_fault` (FAILED unknown, "unclassified fault (TradeReadDeferred)") | 0 |
| T deferral last | arm re-raises immediately (`raise outcome`) | `FAILED ...::test_precedence_a_sibling_refusal_beats_a_bybit_deferral_in_either_key_order[first_member_defers]` (DEFERRED instead of the refusal) | 0 |
| U member binding (extra) | `dataclasses.replace(scope, api_key_id=...)` replaced by `scope` | `FAILED` the tracer and `test_each_member_reads_under_its_own_key_not_the_jobs` | 0 |
| V forced scope (extra) | `with store.trade_read_scope(_forced_scope)` replaced by `if True` | `FAILED` the tracer and `test_each_member_reads_under_its_own_key_not_the_jobs` | 0 |

`git diff --stat PLAN_BASE HEAD` names `equity_reconstruction.py` and `test_reconstruct_whole_account.py` only. STATE.md and ROADMAP.md untouched.

## Deviations from Plan

**1. [Rule 1 - plan text] MT5 sibling instead of a default Bybit sibling in the tracer**
- The plan's behaviour block does not name the sibling's venue; a Bybit sibling reading under the same shared deadline stores windows of its own depending on task interleaving, so "the store holds windows for the job key only" would not be deterministic. An MT5 sibling (the a6 shape is a Bybit member plus other venues) makes it exact. The Bybit-sibling shape is covered by the precedence tests (both members Bybit) and the binding test.

**2. Extra test beyond the plan**: `test_each_member_reads_under_its_own_key_not_the_jobs` (the plan's tracer has the Bybit member as the job's own key, which cannot tell "bound to the member" from "bound to the job's key"). Committed with Task 1. Extra drills U and V for the binding and the scope.

**3. Task 2 permanent and retryable tests run in both key orders** (the plan's behaviour block names one order for them). Collected cases: 7 for the 4 plan-named tests; `grep -acE 'def test_precedence_'` is 4.

**4. Scratch directory**: `/tmp/readceiling-09` is a symlink to a directory under the session scratchpad (the session rule; the plan's verify blocks hardcode the `/tmp` path). The venv is the git-ignored symlink to the main checkout's.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; the only surface used is plan 03's two service-role tables through plan 04's store. Threat register: T-171-25 (precedence tests in both key orders; drill T), T-171-26 (the deferral leaves the outcome loop before the sum and the persist half; the book-unchanged assertion in the tracer and the precedence tests; drill S).

## For the orchestrator and plan 10

- Names as fixed: the forced scope is `_forced_scope` in the forced branch; the deferral WARNING text is `account crawl deferred` (counts and the key / venue ids only, no venue text).
- Plan 10's stalled arm in `_crawl_whole_account` must sit in the same outcome loop. Today a `store.TradeReadStalled` raised by a forced Bybit member (`begin_claim` after three stalled claims, or the 24 h job-age check at the defer point, both now reachable because the forced path has a scope) reaches the loop's generic `BaseException` arm: it is classified unknown and the job ends `_AccountCrawlRetryableError` / FAILED unknown, which is retried. That is the gap plan 10 closes with the `account_key_read_stalled` token; the arm must be placed before the generic arm. Because the loop remembers the deferral and continues, a stalled member and a deferring sibling resolve in key order like a refusal (the stall is raised at its position; the deferral is last).
- The handler's stall arm (plan 08) is generic: a stall raised outside the account crawl on the forced path (plan 10's defensive test monkeypatches `_crawl_whole_account` itself) reaches it and gets the unforced text, not the forced refusal.
- Any test that runs a forced claim with `created_at` near `END_DATE` must patch `store._wall_ms` (use `_resume_rig` here or plan 08's `_rig`), or it stalls as `job_age` at its first defer point.
- The deferred forced job does not touch any `api_keys` marker or audit: the store keeps progress and `defer_compute_job` decrements attempts, so a long read never burns the job's retry budget.

## Self-Check: PASSED

- `analytics-service/services/equity_reconstruction.py` and `analytics-service/tests/test_reconstruct_whole_account.py`: FOUND, nothing under `analytics-service/` uncommitted; module equals its drill backup (`cmp` 0).
- Commits `72ffd1421` and `23d6bd794`: ancestors of HEAD on `wt/171-p09`.
- STATE.md and ROADMAP.md untouched.
