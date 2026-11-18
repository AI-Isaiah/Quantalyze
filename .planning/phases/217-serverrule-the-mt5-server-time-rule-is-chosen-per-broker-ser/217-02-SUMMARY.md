---
phase: 217-serverrule-the-mt5-server-time-rule-is-chosen-per-broker-ser
plan: 02
subsystem: runbooks / MT5 server clock
tags: [mt5, server-clock, runbook, per-server-rule]
requires:
  - phase: 217-serverrule plan 01
    provides: parse_mt5_server_time_rules, unmapped_clock_mismatch page cause, utc as fixed 0
provides:
  - "mt5-go-live.md step 3 documents MT5_SERVER_TIME_RULES (grammar, utc, hash read, no-echo check, failure modes, set-before-deploy)"
  - "navmtm-chain-move-go-live.md P6 reads the per-server map on both worker services"
affects: [217 ship, 155.1 UAT]
status: complete
commits: 2
plan_head_before: eccb96d1930c621da026aec0e2709e4801db51eb
plan_head_after: 01fbcea2ac7d1b68da805330e951141e82a0e468
actuals:
  tokens: 1500
  tasks: 2
  commits: 2
key-files:
  created: []
  modified:
    - docs/runbooks/mt5-go-live.md
    - docs/runbooks/navmtm-chain-move-go-live.md
key-decisions:
  - "Runbook follows the later coordinator instruction: the map is set on BOTH worker services BEFORE the deploy (217-CONTEXT.md Q1 says after deploy; CONTEXT not edited)"
requirements-completed: []
---

# Phase 217 Plan 02: Runbooks for MT5_SERVER_TIME_RULES Summary

An operator can now configure, validate and deploy a per-server MT5 clock rule from the two runbooks alone: variable name, grammar, `utc` as fixed 0, the read-only hash query, a no-echo validation one-liner, every failure mode including the Q2 unmapped-mismatch override and its cost, and the set-before-deploy order; pre-flight P6 reads the per-server map on both worker services.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | mt5-go-live.md step 3 documents the per-server map | 1afa3b605 | docs/runbooks/mt5-go-live.md |
| 2 | navmtm pre-flight P6 reads the per-server entry on both worker services | 01fbcea2a | docs/runbooks/navmtm-chain-move-go-live.md |

## Verification

Task 1 greps: `MT5_SERVER_TIME_RULES` 4 (floor 3), `parse_mt5_server_time_rules` 2, `unmapped_clock_mismatch` 1, `before deploy` (case-insensitive) 1, `Phase 217` 1, 64-hex count 1 (the pre-existing image digest only).
Task 2 greps: `MT5_SERVER_TIME_RULES` 2, `unmapped_clock_mismatch` 1, 64-hex count 0.
`git diff --name-only e2c15996d..HEAD -- docs` lists exactly the two runbooks.

### The no-echo one-liner, run against plan 01's parser (main checkout venv, run from the worktree's `analytics-service/`)

- Synthetic valid key (64 zero characters built at run time with `printf`, mapped to `utc`, never typed into tracked text): prints `1`.
  The plan's own verify command (system `python3`, dict argument) also prints `1`.
- Malformed value (`notahash=eu`): raises `Mt5ServerClockConfigError` with the closed text `MT5_SERVER_TIME_RULES must be comma-separated entries of a 64-character lower-case hex server hash, '=', then 'eu', 'us' or 'utc', with each hash at most once — fail loud`. The value is not echoed.
- Note: the malformed case exits with a Python traceback (the closed message is its last line); the runbook says the error never carries part of the value, which holds.

## Deviations from Plan

None - plan executed exactly as written. The ordering sentence in step 3 was reworded once before commit for clarity.

## Known Stubs

None.

## Threat Flags

None. No code, no secret, no server identity was added; only the known UTC server's 12-character hash prefix appears, as the plan allowed.

## Self-Check: PASSED

Both runbooks exist and carry the edits; commits 1afa3b605 and 01fbcea2a are ancestors of HEAD.
