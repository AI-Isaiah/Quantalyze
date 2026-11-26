---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
reviewed: 2026-11-26T00:00:00Z
round: 1
depth: deep
# Scope: plan 225-21 (closes review WR-01 of PR-2c), `git diff 957827f07 HEAD -- analytics-service/`
# at a851ebd6b on gsd/phase-225-oneaccountonce. Cross-file traces: every production `.login(` and
# `account_info()` call in services/ and routers/, each enforcement site's except arm and its
# handler, classify_exception for the subclass, the settled-history registry and Mt5Client.restart.
# status: clean means NO BLOCKER/HIGH/MEDIUM. The six LOW/Info items below are recorded per the
# repo rule (LOW and Info go in REVIEW.md only, never TODOS.md) and are not actioned.
files_reviewed: 9
files_reviewed_list:
  - analytics-service/services/mt5_read.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/allocator_positions.py
  - analytics-service/tests/test_mt5_read.py
  - analytics-service/tests/test_mt5_derive_branch.py
  - analytics-service/tests/test_mt5_sync_path.py
  - analytics-service/tests/test_allocator_positions.py
  - analytics-service/tests/test_allocator_positions_non_ccxt.py
  - analytics-service/tests/test_key_mode_linked_strategy_recompute.py
findings:
  critical: 0
  warning: 0
  info: 6
  total: 6
  necessity: 0
status: clean
---

# Phase 225: Code Review Report, PR-4 (plan 225-21, poll-path server bracket)

**Reviewed:** 2026-11-26
**Scope:** `git diff 957827f07 HEAD -- analytics-service/`: 3 service files, 6 test files, no migration
**Depth:** deep (cross-file traces of every MT5 terminal read and every enforcement site's disposition)
**Files Reviewed:** 9
**Status:** clean (no BLOCKER, HIGH or MEDIUM)

## Summary

Read against `225-21-PLAN.md` (must_haves, prohibitions P-225-21-01/02, threats T-225-70..74),
`225-21-SUMMARY.md`, `225-20-SUMMARY.md` and review WR-01 in `225-REVIEW-PR2C.md`.
`$HOME/.claude/gsd-core/references/necessity-review.md` was read. The bracket checks data that
comes from another process (the terminal), which is a trust boundary, so it is not a necessity
finding.

**The change does what WR-01 asked, at every site, and each site's test fails when its own
bracket is removed.** There is no BLOCKER, HIGH or MEDIUM finding.

### Verified (measured, not assumed)

- **Coverage of production callers is complete.** Every `.login(` and `account_info()` call in
  `services/` and `routers/` (outside the `Mt5Client` facade) was enumerated. The key-data reads
  are the four sites this plan brackets: `mt5_read.py:342/347` PRE, `:433` POST,
  `job_worker.py:906/909` (balance) and `allocator_positions.py:976/979` (holdings). Validation's
  `run_probe` (`mt5_probe.py:460-530`) already carries PRE and POST server brackets from PR-2c.
  The rest read no account data: `mt5_probe.py:913` is the house relogin, and
  `account_identity` reads `Mt5Session.server` with no terminal call.
  `read_mt5_deal_ledger` has one production caller, the derive (`job_worker.py:8515`).
  `services/equity_reconstruction.py` has no MT5 read. `_mt5_session.client.*` calls in
  job_worker and allocator_positions are exactly the bracketed ones. `scripts/mt5_soak.py` and
  `mt5_spike.py` are operator spike tools, not poll paths.
- **The disposition at each site is unchanged, and nothing is written to the wrong key.**
  - *Derive:* `Mt5ServerMismatchError` is a plain-`Exception` subclass of
    `Mt5AccountMismatchError`. No earlier arm matches it: TimeoutError, Mt5HistoryUnsettledError
    and Mt5SessionAbandoned are unrelated types. The arm at `job_worker.py:8694` does a bounded
    restart and returns FAILED transient before any combine, persist, failed-analytics stamp or
    clock-reading insert. User copy is derived from `error_kind`, never from `error_message`
    (`computation_error` copy function, mig `20261125212222`).
  - *Balance:* the raise lands in the swallow-all arm, returns `None`, and
    `advance_sync_cursor` gets `p_account_balance=None`. COALESCE keeps the previous value, so
    no equity from the refused session is written.
  - *Holdings:* the raise goes through the existing `except Mt5AccountMismatchError` arm (no
    row, restart, `MT5_UNREACHABLE_NOTE`). `_must_reach_handler_unwrapped` consults
    `classify_exception`, which has no type arm for this exception and answers non-permanent,
    so the error is wrapped. The handler arm (`job_worker.py:15837`) updates only
    `api_keys.sync_status/sync_error` and leaves existing holdings rows alone.
- **Ordering.** At every site the order is login check, then verdict line, then server assert,
  all on the same snapshot. At POST, the server assert comes before
  `note_mt5_history_settled`. There is no second verdict line at POST.
- **No leak.** `Mt5ServerMismatchError`'s message is fixed and carries no login and no server.
  The derive and holdings arms log `str(exc)` and the balance arm logs the class name plus the
  scrubbed fixed text. `sync_error` is the fixed note. The site tests casefold-check both
  server names and the login digits in every record and message.
- **Server-name comparison.** `session.server` is always a non-blank stripped `str`
  (`parse_mt5_credentials`, `mt5_validation.py:187`), so `normalise_mt5_server` cannot meet a
  `None` on the requested side.
- **MT5 API claims match the docs (fetched 2026-11-26).**
  - `mt5login_py`: "server [in] Trade server name. Optional named parameter. If no server is
    set, the last used server is applied automatically."; returns "True in case of a successful
    connection to the trade account".
  - `mt5accountinfo_py`: a namedtuple, or None on error; the example carries
    `server=MetaQuotes-Demo`.
  - `mt5initialize_py`: with no server, "the server for a specified trading account saved in
    the terminal database is applied automatically".
  - The comments in `mt5_read.py` and `job_worker.py` claim nothing beyond these.
- **Test validity, reproduced independently.** Each bracket was neutered in a scratch copy of
  `analytics-service/` (the worktree was not touched), and the five affected test files were run:
  - PRE `mt5_read` assert deleted: 6 failed. These were the read-level refusal ×2, the derive
    PRE site ×2 and J7 ×2. The POST site tests stayed green, as they should.
  - POST assert deleted: 2 failed (derive POST site ×2).
  - Balance assert deleted: 4 failed (function-level ×2, `run_sync_trades_job` site ×2).
  - Holdings assert deleted: 4 failed (function-level ×2, `run_poll_allocator_positions_job`
    site ×2).
  - The real tree, run over the six changed test files plus `test_mt5_handover.py`: 465 passed.

## Narrative Findings (AI reviewer)

No BLOCKER, HIGH or MEDIUM. Recorded only (LOW/Info, not actioned):

### IN-01 (LOW): the POST "refusal never marks history settled" ordering is unpinned, and it is load-bearing

**File:** `analytics-service/services/mt5_read.py:437-444`

The comment says the POST server assert sits before `note_mt5_history_settled` "so a refusal
never marks the key's history settled". Swapping the two lines in a scratch copy left
`test_mt5_read.py`, `test_mt5_derive_branch.py` and `test_mt5_sync_path.py` at 181 passed. The
current code is correct, so this is a test gap and not a live defect.

The ordering matters because the arm's recovery would not undo a wrong record:
`Mt5Client.restart` (`mt5_client.py:3454-3570`) reconnects and does not re-stamp the holder,
so a settled record written before the refusal would outlive the restart until the next holder
stamp.

The POST login twin is equally unpinned (pre-existing; `test_post_bracket_catches_a_mid_read_hijack`
asserts only the raise).

**Fix:** a `test_mt5_read.py` case with `settle_history=True`, a stable deal series and a POST
snapshot on another server. Under a lease holder, assert `Mt5ServerMismatchError` and then
`mt5_history_wait_due(tk, key) is True`.

### IN-02 (LOW): a derive POST refusal is logged as `=True` and the refusal line names no holder

**Files:** `analytics-service/services/mt5_read.py:437-439`; `job_worker.py:8714-8719`; `allocator_positions.py:1090-1095`

The verdict line records the PRE snapshot only. A POST refusal therefore appears as one
`session_server_matches_requested=True` line, followed by a refusal WARNING that carries
`str(exc)` and no holder or label. In logs it is attributable only by adjacency, though
`compute_jobs` carries the key.

Two consequences:
- The parity test's docstring ("a poll can no longer be logged as matching and refused") is true
  of the predicate but not of a POST refusal.
- Task 3's "same holder on two consecutive cycles" rule needs the DB for POST refusals.

The practical risk is low: a POST refusal follows a PRE pass on the same predicate, so it is a
genuine mid-read move, not a false refusal.

**Fix (optional):** add `holder=%s` (through `normalize_mt5_holder`) to the two arms' WARNINGs,
or note in Task 3 that POST refusals are attributed via `compute_jobs`.

### IN-03 (Info): refusal WARNING text still says "login bracket"

**Files:** `job_worker.py:8715`, `allocator_positions.py:1091`

A server refusal logs "mt5 login bracket rejected a mismatched terminal account (MT5 account
mismatch: the terminal presented the expected login on another broker server)". It can be told
apart only by the parenthetical. Task 3 should count `on another broker server` (derive and
holdings) and `exc_class=Mt5ServerMismatchError` (balance), not the prefix.

### IN-04 (Info): J7's test name is stale

**File:** `analytics-service/tests/test_mt5_derive_branch.py:3440`

`test_a_blank_server_falls_back_to_the_default_rule` now asserts the derive is refused (FAILED
transient, nothing stored). The docstring explains this; the name says the opposite.

### IN-05 (Info): the module docstring names a second caller that does not exist (pre-existing)

**File:** `analytics-service/services/mt5_read.py:5-7, 34-38`

The docstring says the full-backfill job (`services/equity_reconstruction.py`) needs the same
read and "answers some of them DIFFERENTLY". That module has no MT5 read, and the PRE comment
in the same file says the derive is the only production caller. The plan edited neighbouring
lines and left this one.

### IN-06 (Info): the balance site's predicate was never measured on PROD

**Context:** `225-20-SUMMARY.md` Task 3 reading

Plan 20 saw 0 `sync_trades_balance` verdict lines in its window, so the 28/28 True figure covers
derive and holdings only. The balance read uses the same session and the same predicate, and a
false refusal there costs one advisory snapshot (`None`), never a wrong write. Task 3 should
still report this site's count.

---

_Reviewed: 2026-11-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
