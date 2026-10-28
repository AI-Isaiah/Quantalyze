---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
plan: 10
subsystem: analytics-service
tags: [trade-read, forced-rebuild, closed-vocabulary, refusal-token, probe]
status: complete

requires:
  - phase: 171-readceiling
    provides: "plan 01's nine typed truncation sites in the probe; plan 08's handler stall arm and job-age backstop; plan 09's forced scope and the deferral-last outcome loop"
provides:
  - "account_key_read_stalled, the 16th closed forced-refusal token: a forced member whose read makes no progress refuses the account by name, writes nothing, keeps its windows"
  - "the forced side of the handler's stall arm (same token through _forced_refusal_result)"
  - "the two token-count pins moved to 16, a pin tying the probe's site tuple to TRUNCATED_READ_SITES, and the dated post-deploy handoff amendment"
affects: [171-12]

actuals:
  tokens: 6500
  tasks: 3
  commits: 3
commits: 3
plan_head_before: 6fbe38ed42a0b608d6395615d33b428440cc47e7
plan_head_after: 90787b39498b729f77c6b1649d34ac07fe8aaa01

tech-stack:
  added: []
  patterns:
    - "a deterministic member outcome (stall) resolved in key order like a refusal, ahead of the generic arm; the non-deterministic one (deferral) stays last"

key-files:
  created: []
  modified:
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/tests/test_reconstruct_whole_account.py
    - analytics-service/tests/test_reconstruct_force_rebuild.py
    - analytics-service/tests/test_bybit_two_year_window.py
    - analytics-service/tests/test_allocator_history_probe.py
    - .planning/phases/167.2.1.1.2-acctrebuild-a-bybit-backed-account-s-past-allocation-history/167.2.1.1.2-09-SUMMARY.md

key-decisions:
  - "the stalled arm sits right after the refusal arm in _crawl_whole_account's loop (key order, before the settled-MT5 and generic arms); the deferral stays last, so a stalled member and a deferring sibling resolve by the stall"
  - "no new audit action and no new logger line shape: the existing 'account crawl refused' WARNING carries the token"

requirements-completed: [SC-1]
---

# Phase 171 Plan 10: the 16th refusal token, account_key_read_stalled Summary

A forced whole-account rebuild whose Bybit member's read makes no progress (three claims that stored no window, or a job past its 24 h backstop) now refuses the account with the closed token `account_key_read_stalled` instead of ending FAILED unknown (retried), writes nothing, and keeps the member's stored windows so a later run resumes from them; the pin tests, the probe and the post-deploy handoff moved with the token.

PLAN_BASE `6fbe38ed42a0b608d6395615d33b428440cc47e7`. `git rev-list --count PLAN_BASE..HEAD` over the plan: 3 (before this SUMMARY's own commit).

## What was built

- `services/equity_reconstruction.py`
  - `FORCED_REBUILD_ACCOUNT_REASONS` gains `"account_key_read_stalled"`; the comment now says 16 tokens and carries a dated line naming Phase 171 READCEILING and what the token means.
  - `_crawl_whole_account`: an `isinstance(outcome, store.TradeReadStalled)` arm after the refusal arm and before the settled-MT5 and generic arms. It logs the existing `account crawl refused` WARNING (key, venue, `reason=account_key_read_stalled`; no venue text) and raises `ForcedRebuildRefusedError("account_key_read_stalled") from None`, a double-quoted literal the raise-site scan sees. The docstring states the rule and why.
  - The handler's `TradeReadStalled` arm: `if forced:` returns `_forced_refusal_result(allocator_id, api_key_id, venue, "account_key_read_stalled")`; the unforced text and audit are untouched.
- Tests
  - `test_a_stalled_bybit_member_refuses_the_account_by_name`: the a6-shaped book (Bybit job key on the fake clocks plus an MT5 member), a forced job 30 h old, so the member's real read stores the windows its budget allows and is stopped at its defer point with `job_age`. Asserts `_assert_account_rebuild_refused(... "account_key_read_stalled")` (FAILED permanent, prefix, book unchanged, no window replace, one failure audit), no `defer_compute_job`, the member's windows still in the store under its own key, and exactly one `account crawl refused` WARNING naming key, venue and the token with no `account crawl failed` line.
  - `test_a_forced_job_stalled_at_claim_start_refuses_by_the_same_token`: `_crawl_whole_account` monkeypatched to raise `TradeReadStalled("stalled_claims", ...)` directly; the forced job gets the refusal text through the handler arm. An unforced job on an unmarked sole key whose window crawl raises the same stall keeps its own `trade read stopped: cause=stalled_claims` text (no refusal prefix).
  - Pins moved: `test_forced_rebuild_refusal_reasons_are_a_closed_set` (token added to the account half, `== 16`, docstring "16 tokens", dated note; the raise-site scan is unchanged in form) and `test_the_two_year_refusal_adds_no_token` (`== 16`, dated comment that the 16th token is Phase 171's).
  - `test_the_probe_knows_every_typed_truncation_site` in `tests/test_allocator_history_probe.py`: `set(er.TRUNCATED_READ_SITES) <= set(hp._TRUNCATED_SITES)`.
  - `test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens` needed NO edit: it loops `er.FORCED_REBUILD_REFUSAL_REASONS`, so the 16th token is emitted as both `selection` and `member_refusal` by derivation (it passes with the set at 16).
- `.planning/phases/167.2.1.1.2-.../167.2.1.1.2-09-SUMMARY.md`: a dated section `## Amended 2026-10-27 (Phase 171 READCEILING plan 10): the 16th token and the trade-read deferral` appended. `git diff --numstat` shows 8 added, 0 deleted; no existing line is rewritten. It says: 16 tokens; the import check prints `force_rebuild 0 16 True`; `account_key_read_stalled` joins the re-enqueue-once list (now 8 tokens; record-only stays 8); "outside the 15" reads "outside the 16"; a forced job may now be DEFERRED by its own trade read (back to pending after about 120 s, at most 24 h per job). This file reaches main through the orchestrator's records PR, not the ship branch.

## RED before, GREEN after (Task 1)

Run at the PLAN_BASE module with the new tests and moved pins in place (`red.log` in the session scratchpad): all four FAILED, none ERROR.

| Test | RED | GREEN |
|------|-----|-------|
| `test_a_stalled_bybit_member_refuses_the_account_by_name` | FAILED: `FAILED unknown`, "unclassified fault (TradeReadStalled)" (the stall hit the generic arm) | passes |
| `test_a_forced_job_stalled_at_claim_start_refuses_by_the_same_token` | FAILED: message was the unforced `trade read stopped: ...` text | passes |
| `test_forced_rebuild_refusal_reasons_are_a_closed_set` | FAILED: `account_key_read_stalled` in the right set only | passes |
| `test_the_two_year_refusal_adds_no_token` | FAILED: `assert 15 == 16` | passes |

Baseline `grep -ac 'account_key_read_stalled' analytics-service/services/equity_reconstruction.py` was 0; after it is 6 (set entry, comment, the loop arm's log argument, its raise site, the handler return, docstring text); the single `ForcedRebuildRefusedError("account_key_read_stalled")` raise literal is 1.

The first run of test 2 failed once for a TEST defect, not a code one: its unforced half reused a book whose keys carry the reconstruct marker, so the job short-circuited DONE. The unforced half now seeds an unmarked sole key. Fixed before the commit.

## Drills

Byte-backed up (`cp` to the scratchpad), edited in place, run, restored with `cp`, `cmp` exit 0 every time; never git checkout/restore/stash.

| Drill | Edit | FAILED line | cmp |
|-------|------|-------------|-----|
| probe pin | `"okx_page_ceiling"` removed from `hp._TRUNCATED_SITES` | `FAILED tests/test_allocator_history_probe.py::test_the_probe_knows_every_typed_truncation_site` (only that test; 67 others passed) | 0 |
| U the stalled conversion | the loop arm made unreachable (`isinstance(outcome, ZeroDivisionError)`) | `FAILED tests/test_reconstruct_whole_account.py::test_a_stalled_bybit_member_refuses_the_account_by_name` (FAILED unknown, "unclassified fault (TradeReadStalled)") | 0 |
| U2 the forced side of the stall arm | `if forced:` replaced by `if False:` | `FAILED tests/test_reconstruct_whole_account.py::test_a_forced_job_stalled_at_claim_start_refuses_by_the_same_token` (unforced text for a forced job) | 0 |

## Gates

- Quick run (the six files of the plan): `250 passed, 1 warning`.
- Probe tests alone: `68 passed`.
- Full analytics suite, from `analytics-service/`: `13014 passed, 99 skipped` (plan 09 reported 13011 passed, 99 skipped; +3 are this plan's new tests; none of the 99 skips is from this plan).
- CI mypy line verbatim: `Success: no issues found in 124 source files`.
- `scripts/check-planning-hygiene.ts` (run after the SUMMARY amendment): OK on rules 1, 6 and 7.
- `git diff --stat PLAN_BASE HEAD` names the five code/test files and the one ACCTREBUILD SUMMARY only. STATE.md and ROADMAP.md untouched.

## Deviations from Plan

**1. [Rule 3 - environment] Scratch directory**: the plan names `/tmp/readceiling-10`; the session rule is the scratchpad, so the scratch directory is `readceiling-10` under the session scratchpad (a directory this run created). The plan's verify blocks hardcode the `/tmp` path, so each block's checks were run by hand against the scratchpad path instead of verbatim; the checks themselves (RED lines, `cmp`, quick run, closed-set `-k`, mypy, the `grep` counts, amendment numstat, clean `git status`) were all performed and passed.

**2. [Test shape] The tracer drives the real stall, not a monkeypatched one**: the plan's behaviour block says the Bybit member's read "raises TradeReadStalled" and that its store rows are still present. A monkeypatched raise leaves no rows, so the test uses a job older than 24 h on plan 09's fake-clock rig: the real read stores its windows, then the real defer point raises `job_age`. This also exercises the real store state the refusal must leave behind.

**3. Extra source touches (same files, same intent)**: a dated comment above the token set, and a paragraph in `_crawl_whole_account`'s docstring. No behaviour beyond the plan.

Otherwise the plan was executed as written.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema; the log line reuses the existing `account crawl refused` shape with static fields. T-171-27 (token unknown to the handoff): mitigated, the pins, the probe's derived vocabulary and the dated handoff amendment moved together. T-171-37 (window written after a stall): mitigated, the stall leaves the outcome loop before the sum and the persist half; `_assert_account_rebuild_refused` in the tracer; drills U and U2.

## For the orchestrator and plan 12

- The post-deploy import check now expects `force_rebuild 0 16 True`; the amendment in the ACCTREBUILD 09 SUMMARY says so. Any other document that quotes "15 tokens" for the forced-refusal set should be read as 16 after this phase (a grep of `analytics-service/` found none left in code or tests).
- The amendment file is a `.planning` path: it must reach main through the records PR and stay out of the ship branch (ship planning guard).
- Closed-set order in the handoff: re-enqueue-once now has 8 tokens, record-only still 8, total 16.
- Merge note: this branch touches `equity_reconstruction.py` only in the token set, the `_crawl_whole_account` loop plus docstring, and the handler's stall arm (plus a comment); no signature changed.

## Self-Check: PASSED

Files exist (`171-10-SUMMARY.md` itself, the five edited code/test files, the amended ACCTREBUILD SUMMARY); commits `b050377cc`, `8310c861c` and `90787b394` are ancestors of HEAD; `git status --short` was empty before this SUMMARY; the amendment's numstat is `8 0`.
