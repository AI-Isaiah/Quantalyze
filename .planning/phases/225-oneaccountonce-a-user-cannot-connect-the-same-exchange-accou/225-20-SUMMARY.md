---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 20
subsystem: analytics-service / MT5 polls
tags: [mt5, measurement, log-only, server-verdict, WR-01, CONTEXT-Q6]
requires: []
provides:
  - log_mt5_poll_server_verdict (services/mt5_read.py)
  - read_mt5_deal_ledger keyword-only holder
affects:
  - 225-18 (PR-2c) Task 3 step 1 reads this plan's Task 3 record
  - 225-19 (PR-3) Task 3 reads this plan's enforcement-owner booking
tech-stack:
  added: []
  patterns: ["log-only measurement before an enforcing bracket ships"]
key-files:
  created: []
  modified:
    - analytics-service/services/mt5_read.py
    - analytics-service/services/job_worker.py
    - analytics-service/services/allocator_positions.py
    - analytics-service/tests/test_mt5_read.py
    - analytics-service/tests/test_mt5_derive_branch.py
    - analytics-service/tests/test_mt5_sync_path.py
decisions:
  - "The helper lives in services/mt5_read.py, not mt5_probe.py, so PR-2c0 and PR-2c share no file."
  - "The derive read logs on the PRE snapshot only (one line is one poll); the POST bracket is unchanged."
status: complete
tasks_complete: "3 of 3 (Task 3 read by the phase orchestrator on 2026-11-26: PASS, owner 225-21 booked)"
commits: 2
plan_head_before: c7aec050588f7725c7df1c1fb67529d309ea2ad9
plan_head_after: d306c214e5b90781395c864d39b7ca8d462f9f14
actuals:
  tokens: 6700   # chars/4 over the realized diff of analytics-service (26722 chars)
  tasks: 2       # Tasks 1 and 2; Task 3 pending
  commits: 2     # MEASURED: git rev-list --count c7aec0505..d306c214e (code commits; the SUMMARY commit follows)
completed: 2026-11-25
---

# Phase 225 Plan 20: PR-2c0 poll server verdict Summary

Every MT5 poll read (derive deal ledger, sync balance, allocator holdings) now writes one INFO line, `mt5 poll server verdict site=<site> holder=<normalised> session_server_matches_requested=<True|False|not_captured>`, using the predicate PR-2c's `assert_expected_server` applies, and nothing a poll returns or stamps changes.

Tasks 1 and 2 are done and committed. Task 3 (post-deploy count, PR-2c gate, enforcement owner) is the orchestrator's and is left pending below.

## What was built

- `log_mt5_poll_server_verdict(info, *, requested_server, site, holder) -> bool | None` in `services/mt5_read.py`. A non-blank `str` server is compared through `normalise_mt5_server` (True/False); absent, non-string or blank is `not_captured` (None, what PR-2c would refuse). One INFO record on `quantalyze.analytics.mt5_read`, static message, `site`, `holder` via `normalize_mt5_holder`, then the verdict, in that order. Total over every `info["server"]` shape, never mutates `info`, no try/except needed.
- `read_mt5_deal_ledger(..., holder=None)`: calls the helper once, right after the PRE `assert_expected_login`, with `site=SITE_DERIVE`. The POST bracket and `Mt5DealLedgerRead` are unchanged. `job_worker`'s derive passes `holder=ctx.key_row.get("id")`.
- `job_worker._fetch_mt5_account_balance._read`: calls the helper (`SITE_BALANCE`, `holder=api_key_id`) only after the login check passes, then returns `info` unchanged.
- `allocator_positions` `_mt5_read`: calls the helper (`SITE_HOLDINGS`, `holder=api_key_id`) after `_assert_expected_login(info)`, then returns `info` unchanged.
- `services/mt5_read.py` module docstring: the leaf-module import list now names `services.mt5_handover` (the site literal and holder normaliser). `import services.allocator_positions` and `services.job_worker` import cleanly; no cycle.

## Verification

Commits: `5bb23d2c2` (Task 1), `d306c214e` (Task 2).

pytest, from `analytics-service/`:

- Task 1 selection `tests/test_mt5_read.py tests/test_mt5_derive_branch.py`: `134 passed, 26 warnings in 25.44s`
- Task 2 selection `tests/test_mt5_sync_path.py tests/test_allocator_positions.py tests/test_mt5_read.py`: `210 passed in 25.54s`
- Whole MT5 selection `python3 -m pytest -q -k "mt5" -p no:cacheprovider`: `2974 passed, 1 skipped, 13828 deselected, 616 warnings in 172.64s (0:02:52)` (re-run with `-rs`: `2974 passed, 1 skipped, 13828 deselected, 616 warnings in 181.58s (0:03:01)`)
- The one skip is pre-existing and unrelated: `SKIPPED [1] tests/test_mt5_validate.py:713: got empty parameter set for (observation)`.

mypy, the CI `python` job's exact command (`.github/workflows/ci.yml`, step "Type gate - mypy strict over the running-service surface"), run from `analytics-service/`:

```
mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py
Success: no issues found in 143 source files
```

Acceptance greps: `def log_mt5_poll_server_verdict` 1 in mt5_read.py; `session_server_matches_requested=` present in mt5_read.py; `holder=ctx.key_row.get("id")` 2 in job_worker.py; `log_mt5_poll_server_verdict(` once each in job_worker.py and allocator_positions.py; `session_server_matches_requested` in test_mt5_derive_branch.py (1) and test_mt5_sync_path.py (3).

## Tests written first, and every neuter went RED

Tests were written and run RED before the implementation: the read/helper file failed at collection on the missing import, the derive tracer failed at `assert len(matching[2]) == 1` (`assert 0 == 1`) after its data-equality assertions passed, and the six balance/holdings verdict tests failed. Each neuter below was applied to a byte copy kept in the session scratchpad and restored with `cp`, then `cmp` printed no difference. No `git checkout`, `restore` or `stash` was used.

| Neuter | RED line |
|---|---|
| (a) raw compare instead of `normalise_mt5_server` | `FAILED tests/test_mt5_read.py::test_the_verdict_is_the_pr2c_predicate_and_writes_one_info_line[case-and-spaces-only]` (1 failed, 133 passed) |
| (b) helper always True | `FAILED ...::test_the_verdict_is_the_pr2c_predicate_and_writes_one_info_line[different-server]`, `FAILED ...::test_the_read_returns_the_same_data_whatever_the_verdict_and_logs_one_line`, `FAILED tests/test_mt5_derive_branch.py::test_a_derive_poll_on_another_server_logs_false_and_stores_what_a_match_stores` (3 failed, 131 passed) |
| (c) drop `holder=` from the derive call | `FAILED tests/test_mt5_derive_branch.py::test_a_derive_poll_on_another_server_logs_false_and_stores_what_a_match_stores` (1 failed, 133 passed) |
| (d) delete the helper call in `read_mt5_deal_ledger` | `FAILED ...::test_the_read_returns_the_same_data_whatever_the_verdict_and_logs_one_line`, `FAILED ...::test_a_read_without_a_holder_attributes_nothing`, `FAILED ...test_a_derive_poll_on_another_server_logs_false_and_stores_what_a_match_stores` (3 failed, 131 passed) |
| (e) delete the balance call | `FAILED tests/test_mt5_sync_path.py::test_the_balance_read_logs_one_server_verdict_and_returns_the_same_equity[matching / other-server / no-server]` (3 failed, 26 passed) |
| (f) delete the holdings call | `FAILED tests/test_mt5_sync_path.py::test_the_holdings_read_logs_one_server_verdict_and_returns_the_same_rows[matching / other-server / no-server]` (3 failed, 26 passed) |
| (g) extra: balance verdict moved before the login check | `FAILED tests/test_mt5_sync_path.py::test_a_balance_read_on_a_mismatched_login_writes_no_verdict_and_still_returns_none` (1 failed, 28 passed) |

Restores: every `cmp` against the byte copy was silent (`restored-a` through `restored-d`, `restored-c`, `restored-balance`, `restored-holdings`, and the final order-neuter restore).

What the tests pin: the verdict is the PR-2c predicate over True, case-and-space-only difference, different server, and absent, None, empty, blank and non-string; the record is exactly `mt5 poll server verdict site=... holder=... session_server_matches_requested=...` with no server (case-folded), login digits or password; a non-UUID holder (including a digit-only one) is `unattributed`; a False or not_captured poll returns equal deals, tick and info as a True one; exactly one record per `read_mt5_deal_ledger` call even though the POST bracket also reads `account_info()`; the derive job's outcome, upserts, updates and rpc calls are equal for a matching and another server, with one `=False` line carrying the key UUID; a mismatched login writes no verdict at the balance and holdings sites and keeps its disposition (None; `AllocatorHoldingsSyncTransientError`).

## MT5 venue documentation relied on

Both pages were fetched and read by this executor on 2026-11-25 (curl, text extracted), and nothing beyond them was relied on:

- https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py: `account_info()` returns a named tuple, or None on error, and "returns all data that can be obtained using AccountInfoInteger, AccountInfoDouble and AccountInfoString in one call" (the string properties include the account's server).
- https://www.mql5.com/en/docs/python_metatrader5/mt5login_py: `server` is "server name as it is specified in the terminal", optional (the last used server is applied when omitted), and the return is True on a successful connection.

Neither page says the server `account_info()` reports equals the name `login()` was given. That gap is what this log line measures; no code here assumes it. The helper's docstring cites both URLs. Parameter semantics also read from the login page: `server` is optional, and omitted it falls back to the terminal's last used server, which is why the measurement compares what the session requested against what the terminal reports.

## Deviations from Plan

None to the code. Two process notes:

- The worktree branch is `gsd/phase-225-pr2c0`, a named branch rather than the `agent-*` namespace the protected-branch allow-list expects. The orchestrator dispatched this plan onto it deliberately, so the allow-list check was not applied; HEAD was confirmed attached, on a non-protected branch, in a linked worktree before each commit.
- `tests/test_mt5_read.py`'s `_account` gained an optional `server` keyword (sentinel default, so existing callers are byte-identical); `tests/test_mt5_derive_branch.py` gained `import logging`. No pre-existing test needed filtering, and no assertion about logins, servers or passwords was weakened.

## Known Stubs

None.

## Threat Flags

None. The only new output is the static-message verdict line; T-225-65 (no login, server or password) and T-225-66 (helper total, returns and stamps unchanged at all three sites) are covered by the tests above.

## Task 3 (pending): the orchestrator's post-deploy checkpoint

Not done by this executor, by instruction. Preconditions: PR-2c0 merged to main through the house `-pr` filter, CI green on its head SHA with the expected check count, analytics `/health` `git_sha` at or after the merge SHA. Ship guard: `git diff --name-only origin/main...HEAD | grep -c '^.planning/'` must print 0 on the PR-2c0 branch (this execution branch carries the phase's plans and CONTEXT, so it must be re-cut through the filter, not pushed as is).

What the orchestrator must read, read-only, holder ids and server names kept in the scratchpad and never in a tracked file:

1. Railway analytics logs for lines containing `session_server_matches_requested=`, after one full daily cycle (the holdings site runs from the `poll-allocator-positions` pg_cron job, daily 04:00 UTC per migration 20260420073003; derive and balance run from the strategy sync). Read soon after the polls; count each line once by timestamp, site and holder.
2. ZERO lines is a STOP (deploy not live, or `LOG_LEVEL` filtering INFO), never a pass.
3. Counts by value and site: True, False, not_captured for `derive_broker_dailies`, `sync_trades_balance`, `allocator_holdings`.
4. Per-server coverage: distinct holder ids from the lines, mapped by one PROD read (marker query first, one query per call) to the stored `venue_server` of live active MT5 keys, plus the distinct live `venue_server` count (4 on 2026-11-25). Synthetic labels S1..Sn with per-label True/False/not_captured. A live server with no attributed line after two daily cycles is "not determinable" with the reason, and is named to the founder.
5. Verdict: PASS when lines > 0, False = 0, not_captured = 0, and every determinable live server has at least one True. Any False or not_captured is a STOP to the founder; PR-2c does not merge.
6. Book the poll-path refusal (review WR-01) on a PASS or a STOP: add `## Poll-path server enforcement: owner` to this file (owner 225-21 on a PASS, the founder's decision verbatim on a STOP), and one bold prose line under the Phase 225 plan list in ROADMAP.md naming it. The `## Poll-path server enforcement: owner` heading is deliberately NOT present yet, so the plan's acceptance grep stays false until Task 3 runs.

Review WR-01 amendment (the log-only verdict now also runs on the VALIDATION terminal, inside `run_probe`, with `site=validate_wizard` or `validate_worker` and `holder=validation`):

- Step 3 also counts `validate_wizard` and `validate_worker`.
- The PASS rule in step 5 also requires 0 False and 0 not_captured on the validation sites. A False or not_captured on either is a STOP.
- Coverage is per KEY, not per line. Count the distinct live MT5 keys polled in the window against the distinct holders seen in the lines, and report the keys with zero lines per site. A server counts as covered only if its keys were polled. Validation lines carry `holder=validation`, so they cannot be attributed to a server and cover no server; they only gate the PASS.

Note for the orchestrator: the PR-2c work branch carries its own, now stale, copy of 225-18-PLAN.md; the revised plan 18 is on the phase branch.

## Task 3 reading, 2026-11-26 (verdict half only, relayed by the main session)

Railway analytics logs, read by the main session around 2026-11-26 01:00Z: **3 of 3** captured `session_server_matches_requested=` lines read **True**, all at site `allocator_holdings`. **0 False, 0 not_captured.**

What this reading does NOT yet cover, so it is recorded and not called a PASS under step 5:

- No counts were relayed for `derive_broker_dailies`, `sync_trades_balance`, `validate_wizard` or `validate_worker`.
- Per-key and per-server coverage (step 4) was not relayed: which live MT5 keys the 3 lines belong to, and whether every determinable live server has a True.
- The `## Poll-path server enforcement: owner` heading (step 6) is therefore still not written.

The other half of PR-2c's merge gate, the founder's wrong-server connect attempt, is relayed by the main session (2026-11-26) as still owed. Note the tension with the 2026-11-25 record in 225-CONTEXT.md, which treats the founder's two PROD wrong-server attempts (both refused at login with `last_error` -6) as plan 19 Task 3 step 6's measurement. PR #1344 (PR-2c, v0.133.82.0 at head `a1e38baf0`, 28/28 green) stays a DRAFT at the end of the merge queue until both halves are closed.

## Self-Check: PASSED

- Files modified exist: `analytics-service/services/mt5_read.py`, `job_worker.py`, `allocator_positions.py`, and the three test files (FOUND).
- Commits `5bb23d2c2` and `d306c214e` are ancestors of HEAD (FOUND).
- No stubs; no login, server, password or key id of a real account in this file (the UUIDs in tests are synthetic).

## Task 3 reading, 2026-11-26 ~10:30Z (full read by the phase orchestrator; supersedes the partial reading above as the verdict)

Railway logs, both services, filter `session_server_matches_requested`, from 2026-11-25T12:00Z (after PR-2c0's deploy, #1346 `a4979ed94`). Each line counted once by timestamp, site and holder. Holder ids were mapped to stored servers by one PROD read (marker query first, it named PRODUCTION) and are kept out of this file.

| site | True | False | not_captured |
|---|---|---|---|
| `allocator_holdings` (analytics service, 01:00-01:08Z daily poll) | 11 | 0 | 0 |
| `derive_broker_dailies` (worker service, 00:56-01:50Z) | 17 | 0 | 0 |
| `sync_trades_balance` | 0 | 0 | 0 |
| `validate_wizard` / `validate_worker` | 0 | 0 | 0 |

Coverage, per key: PROD has 11 live active MT5 keys on 4 distinct stored servers. The 11 holders in the `allocator_holdings` lines are exactly those 11 keys (11/11), and they span 4/4 servers. The derive lines cover the same 11 holders (17 lines; 6 keys were derived twice in the window).

Not seen, and why it does not block: `sync_trades_balance` wrote no line in the window (no MT5 balance read ran through that site), and the validation sites wrote none because the 2026-11-26 founder attempts were refused at the broker's sign-in, before the verdict line (225-18-SUMMARY.md). Neither site produced a False or not_captured.

**Verdict under step 5: PASS.** Lines > 0, 0 False, 0 not_captured, every determinable live server (4/4) covered by at least one True.

## Poll-path server enforcement: owner

Owner: **follow-up gap plan 225-21** (booked 2026-11-26 on the PASS above, per step 6). Scope: the enforcing server bracket at the three MT5 poll reads (`read_mt5_deal_ledger` PRE and POST in `services/mt5_read.py`, the balance read in `services/job_worker.py`, the holdings read in `services/allocator_positions.py`), using PR-2c's `assert_expected_server` and `Mt5ServerMismatchError` (both on main since #1344, `2aa1a0cbb`). Review WR-01 of PR-2c, CONTEXT Q6 item 1. It is not shipped on origin/main at this date: `git grep -c "assert_expected_server(" origin/main` over the three files prints nothing. Plan 225-21 is not yet written, so it is not a ROADMAP plan row; the ROADMAP carries one prose line naming it.
