---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 21
subsystem: analytics-service MT5 poll reads
tags: [mt5, broker-server, assert_expected_server, poll-brackets, WR-01]
status: partial

requires:
  - phase: 225
    provides: plan 18 assert_expected_server and Mt5ServerMismatchError; plan 20 log_mt5_poll_server_verdict and the PROD measurement (28 of 28 True)
provides:
  - the server bracket at all four MT5 poll reads (deal-ledger PRE and POST, sync balance, allocator holdings)
  - fakes that report the server they were logged in to, with a report_server opt-out
affects: [225 Task 3 post-deploy reading, CHANGELOG theme for the ship]

actuals:
  tokens: 16500
  tasks: 2
  commits: 2
plan_head_before: 957827f07ba7811804951a2cfaeb852f7c372179
plan_head_after: 0bdd8212a35a59404ae661370ac3633650563123

tech-stack:
  added: []
  patterns: [verdict line written BEFORE the refusing bracket, so a refused poll is still attributed to its key]

key-files:
  created: []
  modified:
    - analytics-service/services/mt5_read.py
    - analytics-service/services/job_worker.py
    - analytics-service/services/allocator_positions.py
    - analytics-service/tests/test_mt5_read.py
    - analytics-service/tests/test_mt5_derive_branch.py
    - analytics-service/tests/test_key_mode_linked_strategy_recompute.py
    - analytics-service/tests/test_mt5_sync_path.py
    - analytics-service/tests/test_allocator_positions_non_ccxt.py
    - analytics-service/tests/test_allocator_positions.py

key-decisions:
  - "Verdict line stays beside the bracket (Q3): login check, then the plan 20 line, then assert_expected_server; POST adds the assert and no second line"
  - "A not_captured session is refused at every site (Q1); each site keeps its existing Mt5AccountMismatchError disposition unchanged (Q2)"
---

# Phase 225 Plan 21: Poll-path server bracket Summary

**status: partial.** Tasks 1 and 2 are done and committed. Task 3 (the post-deploy Railway reading of one daily poll cycle, gate blocking-human) is PENDING and belongs to the orchestrator; it cannot run before the PR merges and deploys.

One-liner: every MT5 poll read (derive deal-ledger PRE and POST, sync balance, allocator holdings) now calls `assert_expected_server` right after its login check and plan 20's verdict line, so a terminal still on the same login at another broker server (or one that names no server) stores nothing, through each site's existing transient, no-stamp disposition.

## Tasks

| Task | Name | Status | Commit |
| ---- | ---- | ------ | ------ |
| 1 | tracer: deal-ledger PRE and POST server brackets, end to end from the derive | done | 6eda7b35a |
| 2 | balance read and holdings read brackets, end to end from their jobs | done | 0bdd8212a |
| 3 | post-deploy poll cycle read on Railway | PENDING (post-deploy, orchestrator) | none |

`commits: 2` is measured with `git rev-list --count ${plan_head_before}..HEAD` before this SUMMARY's own commit.

## What changed

- `services/mt5_read.py`: imports `assert_expected_server`; calls it after the PRE verdict line and after the POST `assert_expected_login`, before `note_mt5_history_settled`, so a POST refusal never marks history settled. Module docstring, `log_mt5_poll_server_verdict` docstring (the helper itself never raises; the line records a poll that is then admitted or refused) and the PRE comment rewritten.
- `services/job_worker.py`: `assert_expected_server` added to the `services.mt5_probe` import and called in `_fetch_mt5_account_balance._read` after the verdict line; it lands in the existing swallow-all arm (no balance snapshot). Docstring and call-site comment updated; one comment line on the derive arm noting it also takes `Mt5ServerMismatchError`. No code change in any `except` arm.
- `services/allocator_positions.py`: same call in the holdings `_mt5_read`; refusal goes through the existing `except Mt5AccountMismatchError` arm (no row, restart, `MT5_UNREACHABLE_NOTE`). Comments updated.
- Fakes: `_FakeMt5Transport` in `test_mt5_derive_branch.py` and `test_mt5_sync_path.py`, the one in `test_key_mode_linked_strategy_recompute.py` and `_RecordingMt5Transport` in `test_allocator_positions_non_ccxt.py` record the server `login()` receives and echo it in `account_info()` only when the configured dict has no `"server"` key (a configured value of any kind is returned verbatim); `report_server=False` turns the echo off. `_session` and `_build_ctx` gained `server=` (default "Broker-Live", so existing callers are byte-identical).
- Server-clock tests: 12 `_build_ctx` call sites (covering the parametrised clock tests) now request the server they plant. J6 still reports "  Planted-SERVER-Value " and requests "Planted-Server-Value". `_clock_transport(server=_NO_SERVER)` builds the fake with `report_server=False`.
- J7 rewritten: both cases (missing key, blank string) now assert FAILED transient, no reading row, nothing upserted, inserted or updated, `history_deals_get` never called, no page. `mt5_server_clock.py` untouched; the pure-seam default stays covered by `test_a_missing_server_hash_is_never_looked_up`.
- Tests added: PRE site test and POST site test (derive, two cases each), inverted plan 20 read pins (matching returns one True line; other server and not_captured raise `Mt5ServerMismatchError` after one line, deals never fetched), the verdict/bracket parity test (8 shapes), balance function-level and site tests, holdings function-level and site tests. `test_mt5_equity_extraction_arm_follows_the_live_classifier_verdict` now gives its account the session's server and asserts the captured exception is a `ValueError` in all three cases (so it can no longer pass through the server refusal).

## Evidence (PROOF-01)

MT5 docs relied on (fetched and read 2026-11-26), claims restricted to what they state:
- https://www.mql5.com/en/docs/python_metatrader5/mt5login_py: `server` is the trade server name "as it is specified in the terminal", optional; "If no server is set, the last used server is applied automatically"; returns True on a successful connection.
- https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py: returns a named tuple (None on error); "all data that can be obtained using AccountInfoInteger, AccountInfoDouble and AccountInfoString in one call".
- https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py: with no server, the server saved in the terminal database for the account is applied.
None of the pages says what `login()` does when the terminal already holds that login on another server; the bracket makes that irrelevant to what a poll stores.

### Task 1

RED before the change (untouched `mt5_read.py`, test_mt5_derive_branch.py plus test_mt5_read.py): `8 failed, 139 passed`: J7 x2, PRE site x2, POST site x2, read refusal x2.

Neuters (byte copy in the scratchpad, `cp` back, `cmp` silent each time), selection `-k "pre_bracket_refuses or post_bracket_refuses or another_server_or_none or logged_verdict_is_true"` (14 tests, 14 passed at baseline and after every restore):
- (a) PRE call deleted: `4 failed, 10 passed`: PRE site test x2 and the read refusal test x2. The POST site tests stay green (POST reports the right server in that fixture; it cannot mask the PRE case).
- (b) POST call deleted: `2 failed, 12 passed`: POST site test x2 (another server, not_captured).
- (c) `assert_expected_server` in a byte copy of `mt5_probe.py` accepting None (`is False` for `is not True`): `8 failed, 6 passed`: PRE not_captured, POST not_captured, read refusal not_captured, and the five parity cases absent/none/empty/blank/non-string.
- cmp silent after (a), (b) and (c); re-run `14 passed`.

### Task 2

RED before the service edits (Task 1 tree): `8 failed, 26 passed`: balance function x2, holdings function x2, balance site x2, holdings site x2.

Site neuters (byte copy, `cp`, silent `cmp`), `tests/test_mt5_sync_path.py` (34 tests):
- balance (`job_worker.py` call replaced by `pass`): `4 failed, 30 passed`: balance function x2 and balance site x2 (the equity reaches `p_account_balance`).
- holdings (`allocator_positions.py` call replaced by `pass`): `4 failed, 30 passed`: holdings function x2 and holdings site x2 (the poll reaches complete and emits a row).
- cmp silent after each restore; re-run `34 passed`.

Wrong-reason guard (step 5): the four calls pointed at a local probe raising a `BaseException` subclass whenever `mt5_session_server_verdict` is not True (source edit, restored from byte copies, `cmp` silent for all three files). Union selection: `16 failed, 1330 passed, 1 skipped`. Real-tree `-k mt5` run over the whole suite: `16 failed, 3084 passed, 5 skipped` and the 16 are the identical set. The 16 are all this plan's refusal tests: the four balance/holdings site tests (2 cases each), the two derive PRE and two derive POST site tests, the read refusal test (2), the balance and holdings function-level refusal tests (2 each), and J7 (2). **Wrong-reason list: empty** (no other test reaches a refusal, so no further account needed a server).

### Final gates

- Union selection (the plan's `<verification>` list): `1346 passed, 1 skipped`. The skip is `test_job_worker.py:4677`, "LANE_DB_URL unset (local dev)" (a local-stack lane test, pre-existing and unrelated).
- `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`: `Success: no issues found in 146 source files`.
- `python3 -c "import services.allocator_positions, services.job_worker"`: no cycle.
- Acceptance greps: `assert_expected_server(info, ...)` is present 1x in each of mt5_read.py, job_worker.py and allocator_positions.py, `post_info` form 1x in mt5_read.py; `log_mt5_poll_server_verdict(` 2x in mt5_read.py (definition plus PRE call) and 1x each in job_worker.py and allocator_positions.py; `report_server` 7x in test_mt5_derive_branch.py; `Mt5ServerMismatchError` 5x in test_mt5_read.py and 5x in test_mt5_sync_path.py.

## Deviations from Plan

1. **Branch.** The plan says to execute on a branch cut from origin/main. The orchestrator dispatched this executor onto the linked phase worktree on `gsd/phase-225-oneaccountonce`, so the two commits sit there; the orchestrator ships through the `-pr` filter. No code or behaviour consequence.
2. **Dead helper removed.** `_derive_reporting_server` in `test_mt5_derive_branch.py` served only the plan 20 test this plan replaced; removed with it.
3. **`_StagedFaultMt5Transport.login`** in `test_allocator_positions_non_ccxt.py` overrides `login` without calling `super().login`, so it would not record a server. Left unedited: none of its cases reaches a non-None `account_info()` (initialize raises, login refused, or account_info returns None), and the wrong-reason probe found no refusal there.
4. The plan's "19 server-clock tests" appear as 12 edited `_build_ctx` call sites (several are parametrised), not 19 separate edits.

No Rule 1-3 auto-fixes beyond these; no migration, no schema, no package install; VERSION, package.json, CHANGELOG.md, TODOS.md, STATE.md and ROADMAP.md untouched.

## Handed back (Q4)

- **SF-M1** (a permanently wrong server answered "transient, try again") and **SF-M4** (validation tests that cannot fail on the bracket, IN-01's short-circuit POST site among them) are VALIDATION-path findings in `services/mt5_probe.py`, `routers/exchange.py` and their tests, none of which this plan edits. Their hold condition ("held until the plan 20 measurement") is met, so they need an owner: handed back to the orchestrator. On the poll path SF-M1 does not arise in the same form (a poll mismatch is a terminal-state fault the restart heals); the residual is threat T-225-71, watched by Task 3. SF-M4's poll-path half is met here by construction: each of the four site tests is shown RED with its own bracket neutered.
- WR-02's poll-path twin needs no new code: the derive and holdings arms log `str(exc)` (the fixed "on another broker server" text) and the balance arm logs `exc_class=Mt5ServerMismatchError`; each site test pins that and that no server value or login digits appear.

## CHANGELOG theme (for the ship)

The MT5 poll reads (derive, sync balance, allocator holdings) now refuse a terminal session that is not on the broker server the key was connected with, so a poll can no longer stamp another broker's account that shares the login number; the per-poll server verdict line stays. `### Fixed`, `### Tests`, `### Notes` (the J7 derive path is unreachable by design; no stored number moves; SF-M1 and SF-M4 handed back). No `TODOS.md` entry is closed by this plan.

## Known Stubs

None.

## Threat Flags

None (no new endpoint, auth path, file access or schema surface).

## Post-deploy poll cycle

**PENDING.** Task 3 (`checkpoint:human-action`, gate `blocking-human`) is run by the orchestrator after this plan's PR merges, CI is green on its head SHA and both the analytics and worker services report a `git_sha` at or after the merge SHA. To record here: the deploy SHA, the read windows, the per-site and per-synthetic-label counts of True, False, not_captured and server refusals, and PASS (verdict lines > 0, False = 0, not_captured = 0, refusals = 0, every live active MT5 key polled has a True line) or a founder-routed STOP. Zero verdict lines is a STOP, not a pass. A refusal recurring for the same holder on two consecutive cycles is a false refusal and the default remedy is to revert this PR.

## Self-Check: PASSED

- 6eda7b35a and 0bdd8212a are on `gsd/phase-225-oneaccountonce` (`git merge-base --is-ancestor` checked below at commit time).
- All nine modified files exist; all three service files were restored from byte copies after the probe and the neuters with a silent `cmp`.
