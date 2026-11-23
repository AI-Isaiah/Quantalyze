---
phase: 217-serverrule-the-mt5-server-time-rule-is-chosen-per-broker-ser
plan: 01
subsystem: analytics-service / MT5 server clock
tags: [mt5, server-clock, per-server-rule, ops-alert, fail-loud]
requires:
  - phase: 155.1-serverclock
    provides: the live server-clock reading, the mismatch refusal (D-01) and the readings table
  - phase: 175-mt5offset
    provides: the stdlib clock leaf, resolve_mt5_server_clock and the closed configuration messages
provides:
  - "MT5_SERVER_TIME_RULES: per-server clock map keyed by the full server-label hash (eu | us | utc)"
  - "utc as the fixed offset 0 (reading rows store configured_rule fixed, expected_offset_s 0), no migration"
  - "per-derive clock selection after the read, one clock at the assessment, the reading row and all six offset sites"
  - "two-way mismatch arm: mapped refuses, unmapped writes its reading, pages unmapped_clock_mismatch and continues (Q2)"
affects: [217-02 runbooks and ship, 155.1 UAT, 202-MT5-CLOCK-LEAD-01 (not closed)]
status: complete
commits: 3
plan_head_before: e2c15996d62326b41a2da14274262902aa995bec
plan_head_after: 4c369639b916db7f1e66047b85f92e9f19f555ec
actuals:
  tokens: 11350
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns:
    - "closed-set, value-free configuration message (now five) for a malformed operator map"
    - "selection flag is a returned field (mapped), never derived by comparing clocks"
key-files:
  created: []
  modified:
    - analytics-service/services/mt5_server_clock.py
    - analytics-service/services/job_worker.py
    - analytics-service/services/mt5_server_clock_reading.py
    - analytics-service/services/mt5_deals.py
    - analytics-service/tests/conftest.py
    - analytics-service/tests/test_mt5_server_clock.py
    - analytics-service/tests/test_mt5_derive_branch.py
    - analytics-service/tests/test_mt5_server_clock_readings_parity.py
key-decisions:
  - "Q1: map keyed by FULL 64 lower-case hex server_label_hash, values eu/us/utc; MT5_SERVER_TIME_RULE stays the default (founder-settled)"
  - "Q2: dated founder override of 155.1 D-01 for UNMAPPED servers only: write the reading, page once, continue under the default; mapped mismatch still refuses (founder-settled)"
  - "utc is fixed(0) and exists only as a map value; it is NOT added to MT5_DST_RULE_IDS, so MT5_SERVER_TIME_RULE=utc stays an unknown-rule fault"
  - "Page cause unmapped_clock_mismatch, log arm server_clock_unmapped_drift (distinct from the refusing arm name)"
requirements-completed: []
---

# Phase 217 Plan 01: Per-server MT5 server time rule Summary

The MT5 derive now chooses its server clock per broker server from `MT5_SERVER_TIME_RULES` (full server hash to `eu`, `us` or `utc`), with the existing default variables serving every unmapped server unchanged; a mapped server whose live clock disagrees still refuses, an unmapped one writes its mismatch reading, pages once and continues under the default.

## Tasks

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 | Tracer: a utc-mapped server derives a fixed-zero match end to end | a62cf1359 | mt5_server_clock.py, job_worker.py, conftest.py, test_mt5_server_clock.py, test_mt5_derive_branch.py |
| 2 | Two-way mismatch arm (mapped refuses, unmapped writes and alerts) | 6c3aab0d2 | job_worker.py, test_mt5_derive_branch.py |
| 3 | Grammar, fault table, normalisation, blank server, malformed-map pre-read, stale docstrings | 4c369639b | test_mt5_server_clock.py, test_mt5_derive_branch.py, test_mt5_server_clock_readings_parity.py, mt5_server_clock_reading.py, mt5_deals.py |

## What was built

- Leaf (`mt5_server_clock.py`, still stdlib-only, allow-list test unchanged): `MT5_SERVER_TIME_RULES_ENV`, the fifth closed message `_MALFORMED_RULES_MESSAGE` (tuple is now 5, all distinct), `Mt5ServerClockSelection(clock, mapped)`, `parse_mt5_server_time_rules`, `select_mt5_server_clock`. Grammar: comma-separated `<hash>=<rule>`; entries and both sides of `=` stripped, empty entries skipped, rule lower-cased, key exactly 64 chars from the lower-case hex set (uppercase and non-ASCII fault), duplicate hash faults whatever its value, `a=us=eu` faults. Any fault raises the one closed text with no part of the value.
- Derive (`run_derive_broker_dailies_job`): `_mt5_default_clock` and `_mt5_server_rules` are bound in the one existing pre-read `try` (one except, one `arm=server_clock_config` line). After the read and before the assessment, `_mt5_server_hash = server_label_hash(_mt5_info.get("server"))`, `_mt5_selection`, and the single binding of `_mt5_clock`. The mismatch arm splits on `_mt5_selection.mapped`. The reading insert and its failure arm stay above the split, so an insert failure refuses for every verdict.
- Two stale derive comments (the "ONE clock resolved above" and the D-12 "only carrier" sentence) reworded; `server_label_hash` and `deal_utc_day` docstrings now name the map and the selection.

## Verification

- Full CI pytest (`-n auto --dist loadgroup`, `--cov-fail-under=80`): HEAD baseline before any edit (venv from the main checkout, `.venv/bin/pytest`): **15078 passed, 93 skipped**, coverage 94.66%, exit 0. After the plan: **15120 passed, 93 skipped** (+42, skips unchanged), coverage 94.67%, exit 0. No pre-existing failure and no local-stack-lane dependency surfaced.
- mypy strict (exact CI command): `Success: no issues found in 142 source files`, after each task and at the end.
- Quick four-file suite: 201 passed at the end. Acceptance greps: `-k "rules_map or selection_flags or missing_server_hash"` 20 passed (floor 14); job `-k` set for task 3 12 passed (floor 9); task 2 `-k` set 12 passed (floor 6).
- `npx vitest run` of the three literal-pin tests, run from the worktree with the main checkout's vitest binary (the worktree has no `node_modules`): 3 files, 30 tests passed.
- `git diff --name-only e2c15996d..HEAD -- supabase analytics-service/routers/process_key.py TODOS.md` prints nothing.

## Neuter, RED, restore proofs (all four, each from a byte backup in the session scratchpad, restored by copy, `cmp` exit 0)

1. **Selection** (task 1): `select_mt5_server_clock` made to always return the default unmapped. RED: `test_a_server_mapped_to_utc_persists_a_fixed_zero_match_reading` failed with `AssertionError: derive_broker_dailies: MT5 server clock does not match the configured rule (rule=us expected=+3h measured=+0h)`, and `test_a_rules_map_entry_selects_its_clock_by_full_hash` failed on the `(clock, mapped)` comparison. Restored; `cmp` backup vs restored = **0**; both green again.
2. **Mapped-refuse** (task 2): the mapped branch's `return DispatchResult(...)` replaced by `pass`. RED: both `test_a_server_clock_mismatch_refuses_the_derive_pages_once_and_keeps_its_reading` cases (`map-equals-default`, `map-differs-from-default`) failed with `assert DispatchOutcome.DONE == DispatchOutcome.FAILED`. Restored; `cmp` = **0**.
3. **Unmapped-continue** (task 2): the unmapped branch made to return the transient refusal. RED: `test_an_unmapped_server_clock_mismatch_persists_and_pages_once` and `test_a_map_entry_for_another_server_does_not_rescue_a_mismatch` failed with `assert DispatchOutcome.FAILED == DispatchOutcome.DONE`. Restored; `cmp` = **0**.
4. **Malformed map** (task 3), two neuters of `mt5_server_clock.py`: (a) duplicate-key check removed: `duplicate-same-value` and `duplicate-different-value` (leaf) and `duplicate-hash` (job) FAILED, 3 failed; restored, `cmp` = **0**. (b) the parser made to `return {}` instead of raising: `test_each_configuration_fault_has_its_own_message`, all 14 other leaf fault rows and 5 job rows FAILED (`DONE == FAILED`), 21 failed; restored, `cmp` = **0**, and the restored file `cmp`s equal to the pre-neuter backup.

The date arithmetic behind the `eu` refusal case was checked by hand against the leaf's docstring: on 2026-10-28 the EU change (last Sunday of October, the 25th) has passed so a `eu` broker is +2h, and the US change (first Sunday of November, the 1st) has not so `us` is +3h. A +3h tick therefore matches the `us` default and refuses only because the mapped `eu` clock is the one assessed.

## Deviations from Plan

None to plan content. Environment notes, not code deviations:

- The first baseline attempt used the system Python (no pandas) and failed at conftest import; it was rerun with the main checkout's `analytics-service/.venv` (read only, against the worktree sources), which is what produced the reported baseline.
- Plan-text vs. repo drift only in acceptance criteria: they cite `@a0488e5a4` as the HEAD anchor; the worktree started at `e2c15996d`. Every `HEAD=0` / `HEAD=1` claim re-measured true at the real start.
- The mapped branch of the mismatch arm is semantically identical but is re-indented under `else:` and takes its page `detail` from a shared `_mt5_clock_detail` local (computed once, used by both branches), so it is not byte-identical in the diff.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. The only new outward surface is the `unmapped_clock_mismatch` page cause, already covered by T-217-03/T-217-06; its detail is rule id and hours only and no test record carries the server name or hash.

## Notes for the orchestrator and plan 02

- No migration, no Railway write, no `TODOS.md` edit; `202-MT5-CLOCK-LEAD-01` stays open (this phase does not close it). CHANGELOG, VERSION and runbooks are plan 02 and ship.
- Operator contract now in force once deployed: `MT5_SERVER_TIME_RULES=<64-hex>=utc` set on BOTH analytics services before the deploy; a malformed value fails every MT5 derive pre-read (transient, then `failed_final`).
- STATE.md and ROADMAP.md were left to the orchestrator, as instructed.

## Self-Check: PASSED

- FOUND: analytics-service/services/mt5_server_clock.py, job_worker.py, mt5_server_clock_reading.py, mt5_deals.py, tests/conftest.py, test_mt5_server_clock.py, test_mt5_derive_branch.py, test_mt5_server_clock_readings_parity.py (all modified, all in the three commits)
- FOUND commits (ancestors of HEAD): a62cf1359, 6c3aab0d2, 4c369639b
- `grep -ac "def parse_mt5_server_time_rules"` and the other task acceptance greps meet their floors; `grep -ac "stays the only carrier" job_worker.py` is 0; `grep -ac "one consumer is" mt5_server_clock_reading.py` is 0
