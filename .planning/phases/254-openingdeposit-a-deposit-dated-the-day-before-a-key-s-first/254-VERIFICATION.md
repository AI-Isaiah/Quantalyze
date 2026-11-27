---
phase: 254-openingdeposit-a-deposit-dated-the-day-before-a-key-s-first
verified: 2026-11-27T20:00:00Z
status: passed
score: 4/4 must-haves verified
verified_at_sha: a4df36f6f6414859184db9f5e9bee8304685a3b5
drift_subjects:
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/allocator_equity_compose.py
  - analytics-service/tests/test_allocator_equity_inception.py
behavior_unverified: 0
overrides_applied: 0
---

# Phase 254: OPENINGDEPOSIT Verification Report

**Phase Goal:** A deposit dated exactly the day before a key's first return counts as that key's opening deposit on every venue, not only on Deribit and MT5, without widening `FULL_HISTORY_VENUES`.
**Verified:** 2026-11-27
**Status:** passed
**Re-verification:** No, initial verification

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Off full history, a deposit dated exactly the day before the first return is the opening deposit and not in `out_of_window_flows` (Bybit-shaped fixture) | VERIFIED | `replay_key_equity` (`allocator_equity_derive.py` ~1695-1699): `if not history_reaches_inception:` computes `lo - 1 day`, and `fbd.get(eve) > 0.0` sets `opening_deposit_exempted` and does `out_of_window_flows -= 1` (the eve day is `< lo`, so it was counted once in the preceding sum). Arms: `test_a_bybit_opening_deposit_the_day_before_the_first_return_is_not_out_of_window` (default and explicit `False`, flags `{"opening_deposit_exempted": 1}`, no degrade reasons, level unchanged), `..._not_judged_by_the_zero_start_band`, and the end-to-end `test_job_exempts_a_bybit_opening_deposit_end_to_end` (derive job). |
| SC-2 | A deposit two or more days before, and any later out-of-window flow, still report `out_of_window_flow` | VERIFIED | Arms: `test_a_deposit_two_days_before_the_first_return_stays_out_of_window`, `test_a_two_day_run_off_full_history_exempts_only_the_day_before` (day -2 stays 1), `test_a_post_window_flow_stays_out_of_window_beside_an_exempted_opening_deposit`, `test_a_withdrawal_the_day_before_the_first_return_stays_out_of_window[withdrawal, net-withdrawal-day]`. The exemption is deposit-only (net flow strictly positive). |
| SC-3 | `FULL_HISTORY_VENUES` and the D-13 zero-start checks are unchanged, and a test pins it | VERIFIED | `git diff 68c004338..HEAD` of the derive module shows no +/- line on the `FULL_HISTORY_VENUES` assignment, `_INCEPTION_ZERO_START_BAND` or `_opening_flow_run`; the touched hunks are comments, the docstring, the new block and the flag. Pins: `test_reason_is_blocking_and_the_band_and_venues_are_the_founders` (set equals `{deribit, mt5}`, band 1e-4) and `test_a_full_history_opening_deposit_is_still_judged_by_the_zero_start_band[inside-band, outside-band]` (full-history key never carries the new flag). Wiring pinned by `test_compose_passes_full_history_keys_to_the_replay` and `test_job_reads_the_venue_from_api_keys` (six venues). |
| SC-4 | PROOF-01: each gate RED on a neutered copy with its named arm first, restored from a byte backup (`cp`, `cmp`), GREEN, recorded verbatim in the SUMMARY | VERIFIED | `254-01-SUMMARY.md` `## PROOF-01 (verbatim)` carries N1 to N10, each with the diff, `neutered occurrences=1`, `FAILED` lines, `RED_OK` lines, `restore cmp exit=0` and `GREEN_OK`; tally 32 RED_OK, 10 GREEN_OK, 10 `cmp exit=0`. The pre-fix RED on unmodified code (3 failed, 43 passed) is also verbatim. Independently re-run by this verifier (see below). |

**Score:** 4/4 truths verified, 0 behavior-unverified.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase test module | `cd analytics-service && python3 -m pytest tests/test_allocator_equity_inception.py -q -p no:cacheprovider` | `54 passed in 10.46s` | PASS |
| N1 neuter (`if not history_reaches_inception:` to `if False:`) | same module, byte backup, `cmp` after restore | 6 failed, 48 passed; the SC-1, writer-basis and end-to-end arms went RED; `RESTORED` (cmp exit 0) | PASS |
| N5 neuter (same line to `if True:`) | same module | the D-13 band arms, `test_compose_passes_full_history_keys_to_the_replay` and the existing opening-run arms went RED; `RESTORED` (cmp exit 0) | PASS |

`git status --short -- analytics-service` was empty after both neuters. The full suite was not re-run, per instruction. The SUMMARY records 19 failed, 17633 passed at baseline `68c004338` and 19 failed, 17644 passed after the fix, with an identical failure set (18 quantstats-0.0.81-vs-0.0.86 arms and 1 pytest-xdist arm), mypy strict clean (146 files) and coverage 95.07%.

## Artifacts and Wiring

| Artifact | Status | Details |
|----------|--------|---------|
| `analytics-service/services/allocator_equity_derive.py` | VERIFIED | Substantive and wired: `history_reaches_inception` is passed by the compose and job callers; the flag is an int, so `_bool_flag_tokens` keeps it out of the payload. Level 4 not applicable (no rendered data; the replay output is unchanged). |
| `analytics-service/services/allocator_equity_compose.py` | VERIFIED | One docstring hunk only, no behavior change. |
| `analytics-service/tests/test_allocator_equity_inception.py` | VERIFIED | 54 tests, run green; three old-rule tests reworked with dated intent notes. |

## Requirements Coverage

ROADMAP lists `Requirements: TBD`; no requirement IDs to map. No orphaned requirements.

## Anti-Patterns

No TBD, FIXME or XXX markers introduced in the three modified files (the diff adds comments with the dated founder ruling only). `254-REVIEW.md`: 0 critical, 0 warning, 5 Info, no MEDIUM or above.

## Accepted Limits (recorded, not gaps)

- On retention-capped venues (OKX, Bybit) a day -1 deposit is exempted even when the returns start at the retention edge rather than at the account's start. The founder's narrow-scope ruling accepts this; it is named in the `replay_key_equity` docstring and the SUMMARY's CHANGELOG ship notes.
- A later segment of a Deribit or MT5 key split at an unpriced hole is replayed with `history_reaches_inception=False`, so the day before that segment's first return day is exempted the same way. It never had the D-13 check, so no check is skipped; PROD impact is nil today.
- The PROD book's `out_of_window_flow` clears on the next daily derive; `window_truncated` is untouched. This phase made no PROD write and no migration, so this is not verifiable in the repo.

## Ship-Step Items (not phase gaps)

- The CHANGELOG entry must name the ruling, the `opening_deposit_exempted` count flag and the two limits above.
- No `TODOS.md` entry is closed by this phase (SUMMARY says none names it).

## Gaps Summary

No gaps. Every success criterion is backed by code at HEAD and by a test that this verifier saw fail under a neuter and pass restored.

---

_Verified: 2026-11-27_
_Verifier: Claude (gsd-verifier)_
