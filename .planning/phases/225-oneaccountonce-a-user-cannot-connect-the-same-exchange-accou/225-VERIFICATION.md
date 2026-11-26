---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
verified: 2026-11-26T12:00:00Z
status: human_needed
score: 6/6 roadmap success criteria verified in code; plan 21 must-haves 5/6 verified (the sixth is post-deploy)
verified_at_sha: 9bd2b2a4ebc489d94ff4bd3b1a5a3a022736a9ee
drift_subjects:
  - analytics-service/services/mt5_read.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/allocator_positions.py
  - analytics-service/services/mt5_probe.py
  - analytics-service/services/mt5_client.py
  - analytics-service/services/account_identity.py
  - analytics-service/tests/test_mt5_read.py
  - analytics-service/tests/test_mt5_derive_branch.py
  - analytics-service/tests/test_mt5_sync_path.py
  - analytics-service/tests/test_allocator_positions.py
  - analytics-service/tests/test_allocator_positions_non_ccxt.py
  - analytics-service/tests/test_key_mode_linked_strategy_recompute.py
  - supabase/migrations/20261126140500_api_keys_venue_server_index.sql
behavior_unverified: 0
overrides_applied: 0
prohibitions_flagged:
  - id: P-225-21-01
    verification: judgment
    llm_judge_verdict: "holds in code (non-authoritative)"
    flag: "unverified-prohibition: human review recommended; Task 3 post-deploy reading is the authoritative check"
  - id: P-225-21-02
    verification: judgment
    llm_judge_verdict: "holds in code (non-authoritative)"
    flag: "unverified-prohibition: human review recommended"
human_verification:
  - test: "Plan 18 Task 3, post-deploy POSITIVE CONTROL: on PRODUCTION, in the allocator's add-key form (AllocatorExchangeManager, which posts to validate-and-encrypt), for one of the founder's own MT5 accounts whose key is WORKING, enter the correct login and investor password with the CORRECT server."
    expected: "The 409 already-connected code (KEY_ORPHANED / duplicate-account answer). A transient answer means the server bracket refuses correct sessions: STOP and revert PR-2c. The wrong-server half is already recorded (three attempts, all refused before storage, but all before the bracket was deployed or not proven to be the refuser)."
    why_human: "Needs the founder's real MT5 credentials in the PROD product; nobody writes a login, server or password anywhere. 225-18-SUMMARY.md 'Recorded results' still reads _pending_ for the post-deploy control."
  - test: "Plan 21 Task 3, post-deploy Railway poll-cycle reading (orchestrator): after the PR merges, CI is green on its head SHA and both the analytics and worker services report a git_sha at or after the merge SHA, read the logs of one daily poll cycle for the per-site server verdict lines (derive_broker_dailies, sync_trades_balance, allocator_holdings)."
    expected: "Verdict lines present (zero lines is a STOP, not a pass), 0 False, 0 not_captured, 0 server refusals (the ERROR line 'mt5 server bracket refused the terminal session'), and a True line for every live active MT5 key polled. A refusal recurring for the same holder on two consecutive cycles is a false refusal: revert this PR. Record deploy SHA, windows and per-site counts in 225-21-SUMMARY.md 'Post-deploy poll cycle'."
    why_human: "Cannot run before merge and deploy; needs Railway access. Also the authoritative check on prohibition P-225-21-01 and on threat T-225-71 (a broker spelling its server differently from the key's stored value)."
  - test: "Ownership of the two findings 225-21 handed back: SF-M1 (a permanently wrong server answered 'transient, try again' on the validation path) and SF-M4 (validation tests that cannot fail on the bracket, IN-01 short-circuit POST site among them), both in services/mt5_probe.py, routers/exchange.py and their tests."
    expected: "The orchestrator books each with an owner or records a decision. Their hold condition (the plan 20 measurement) is met."
    why_human: "A routing decision, not a code check. Not a must-have of this phase's success criteria."
---

# Phase 225: ONEACCOUNTONCE Verification Report

**Phase Goal:** A user cannot connect the same exchange account more than once: a second key or draft that reads the same account under the same owner is refused by name at connect time, and any such pair already stored is surfaced and resolved instead of publishing one account's numbers under two names. One key or account shared across several users stays allowed, and a strategy-linked key may also sit in an allocator book.
**Verified:** 2026-11-26 at `9bd2b2a4ebc489d94ff4bd3b1a5a3a022736a9ee` (worktree `quantalyze-wt-225`, branch `gsd/phase-225-oneaccountonce`, code equal to ship PR #1374)
**Status:** human_needed
**Re-verification:** No, initial verification (no prior VERIFICATION.md)

## Scope and method

This run focused on gap plan 225-21 (the server bracket at the MT5 poll reads), its must-haves, and plan 18's open item. The roadmap success criteria for plans 01-17, 19 and 20 (shipped to main as PR-1 through PR-3) were checked for presence and for the recorded evidence in the plan SUMMARYs and review records. Their test suites were NOT re-run here, and a full suite was not run. The one test run in this verification is the seven-file selection below.

## Observable Truths

### ROADMAP success criteria

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Same-owner connect or draft save is refused by name, in the wizard and the API; an own-draft match answers with what was stored, never a silent `200 deduped` (ONCE-01, CONN-01) | VERIFIED (shipped, not re-run here) | `VENUE_DRAFT_IN_PROGRESS` and `KEY_ORPHANED` in `src/app/api/strategies/create-with-key/route.ts`, `src/lib/wizardErrors.ts`, wizard `ConnectKeyStep.test.tsx` and `wizardKeyRosters.test.ts`; the Exchanges-page route `composite/add-key/route.ts` carries the same refusal. Plans 05, 07, 08, 11 SUMMARYs record route tests per venue for exchange keys and MT5. Plan 18 adds route tests that the stored `venue_server` is the validated one. |
| 2 | Same account on two users stays allowed and keeps its share link; refusal is per owner; a strategy-linked key in an allocator book is unaffected (ONCE-02) | VERIFIED (shipped, not re-run here) | Index `api_keys (user_id, exchange, venue_account_id, COALESCE(venue_server,''))` in `supabase/migrations/20261126140500_api_keys_venue_server_index.sql:81` leads with `user_id`, so uniqueness is per tenant. Per-owner pins recorded in plan 11 SUMMARY. |
| 3 | Every same-owner duplicate on PROD counted read-only and brought to the founder; no strategy publishes another key's numbers under its own name once shipped (ONCE-03) | VERIFIED (record-based) | `225-02-SUMMARY.md` PROD run record 2026-11-23: census before matched the founder-confirmed manifest (13 keys, 2 strategies), delete committed, census after: 0 rows, same-owner duplicate count 0, protected keys present 3 of 3, orphan holdings 0. Prevention going forward is the per-owner index plus the connect refusals. This is a dated PROD reading, not re-measured here. |
| 4 | Two keys sharing a login always carry a share link (stamping in `account_identity.py`); MT5 identity includes the broker server; backfill has no data-reading `DO` guard (ONCE-04, CONN-03) | VERIFIED (shipped, not re-run here) | `analytics-service/services/account_identity.py` carries `normalise_venue_server`, `same_venue_server`, `pick_same_account_holder`; server-aware `account_identity_tokens` at `services/allocator_equity_derive.py:573` with the named `account_server_ambiguous` refusal; migration B index carries the server member; SQL twin `20261125151936_commit_scenario_batch_venue_server_identity.sql`. Plan 12 (stamper + backfill census), 14, 15, 16, 17, 19 SUMMARYs. |
| 5 | An MT5 key whose sign-in keeps failing cannot claim a holder slot; a test drives a failing key beside a working one (MT5D-08) | VERIFIED (shipped, not re-run here) | `swap_account_slot` (`20261123180100_swap_account_slot.sql`) is the one place a slot moves; plans 07 and 09 wire the connect and the stamper through it; `225-REVIEW.md` round 2 marks WR-01 to WR-04 resolved with biting gate arms. |
| 6 | PROOF-01: each gate RED on a neutered copy with its named arm first, restored by `cp` and `cmp`, recorded verbatim; migrations pass reviewers | VERIFIED (record-based) | PROOF-01 records are in the plan SUMMARYs (plan 21: neuters (a), (b), (c) for the bracket, per-site neuters for balance and holdings, a wrong-reason probe with an empty list; plan 18: neuter of `assert_expected_server`, 11 tests red). Not re-neutered here. |

### Plan 21 must-haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 21-1 | All four poll reads call `assert_expected_server` on the same snapshot the login check judged | VERIFIED | `mt5_read.py:381` (PRE, `info`) and `:439` (POST, `post_info`, after `assert_expected_login(post_info)` at `:436`); `job_worker.py:923` (balance `_read`, after the inline login check at `:911`); `allocator_positions.py:994` (holdings `_mt5_read`, after `_assert_expected_login(info)`). Grep of `.account_info()` in `services/` and `routers/` finds no further data-read caller: the rest are `mt5_probe.run_probe` (already bracketed by plan 18) and the `mt5_client.py` docstring. |
| 21-2 | A refused poll stores nothing through each site's existing `Mt5AccountMismatchError` disposition | VERIFIED | `Mt5ServerMismatchError` subclasses `Mt5AccountMismatchError` (`mt5_client.py:1068`), a plain `Exception`. Derive: raise precedes `history_deals_get` (PRE) and `note_mt5_history_settled` (POST), the existing arm restarts and returns FAILED transient. Balance: swallow-all arm returns None so `p_account_balance` is None. Holdings: existing arm emits no row. Site tests pass (below) and each was shown RED with its bracket neutered per the SUMMARY. |
| 21-3 | Case and surrounding spaces pass; absent, None, blank, non-string refused | VERIFIED | `assert_expected_server` raises unless `mt5_session_server_verdict(...) is True`; the verdict normalises through `normalise_mt5_server`. Parity test (8 shapes) and J6 and J7 tests in the passing selection. |
| 21-4 | Plan 20's verdict line stays beside the bracket, written before it, one line per poll; `log_mt5_poll_server_verdict` returns True exactly when the assert passes | VERIFIED | Order in all three files: login check, `log_mt5_poll_server_verdict`, `assert_expected_server` (`mt5_read.py:368` then `:381`; `job_worker.py:920` then `:923`; `allocator_positions.py:988` then `:994`). The POST site adds the assert and no second line. Verdict/bracket parity test passes. |
| 21-5 | No refusal log line, `compute_jobs.error_message` or `sync_error` carries a server value or a login | VERIFIED in code, flagged (judgment-tier P-225-21-02) | `Mt5ServerMismatchError` message is fixed and carries no server (`mt5_client.py:1087-1089`). The fix-round ERROR lines log `type(exc).__name__` and the key id only (derive `job_worker.py` arm, holdings arm in `allocator_positions.py`). The balance arm logs `exc_class` and the key id with `scrub_freeform_string(str(exc))`. Site tests pin that no server value or login digits appear. Non-authoritative judgment: human review recommended. |
| 21-6 | After deploy, one daily poll cycle is read on Railway: verdict lines present, 0 False, 0 not_captured, 0 refusals, or a STOP | UNCERTAIN (WARNING, human decision) | Task 3 is `checkpoint:human-action`, status PENDING in `225-21-SUMMARY.md`. Cannot be verified from the codebase. Pre-deploy evidence only: plan 20's PROD read of 2026-11-26 found 28 True, 0 False, 0 not_captured, 11 of 11 live active MT5 keys on 4 of 4 stored servers. |

**Score:** plan 21 code truths 5 of 5 verified; truth 21-6 and plan 18's positive control are human items. No FAILED truths.

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/mt5_read.py` | PRE and POST server bracket after the verdict line | VERIFIED | Lines 381, 439; imports at `:86-87` |
| `analytics-service/services/job_worker.py` | bracket in balance `_read`; derive arm handles the subclass | VERIFIED | `:210` import, `:923` call, derive arm with ERROR log for the subclass |
| `analytics-service/services/allocator_positions.py` | bracket in holdings `_mt5_read` | VERIFIED | `:115` import, `:994` call, explicit subclass arm with ERROR log and bounded restart |
| Six test files | fakes echo the requested server, refusal tests per site | VERIFIED | 465 tests pass (below) |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| mt5_read.py | mt5_probe.py | `assert_expected_server` import | WIRED | `:87` import, two calls |
| job_worker.py | mt5_probe.py | import in the `services.mt5_probe` block | WIRED | `:210`, call `:923` |
| allocator_positions.py | mt5_probe.py | module-level import | WIRED | `:115`, call `:994` |
| job_worker.py derive arm | mt5_client.py | `except Mt5AccountMismatchError` catches the subclass | WIRED | no earlier arm matches the type (the independent code review traced this) |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Poll brackets, dispositions, fakes and the handover seam | from `analytics-service/`: `python3 -m pytest tests/test_mt5_derive_branch.py tests/test_mt5_read.py tests/test_mt5_sync_path.py tests/test_allocator_positions.py tests/test_allocator_positions_non_ccxt.py tests/test_key_mode_linked_strategy_recompute.py tests/test_mt5_handover.py -q -p no:cacheprovider` | `465 passed, 26 warnings in 21.83s` (system python had the deps; the `.venv` fallback was not needed) | PASS |
| Ordering and coverage of the bracket | `grep -n "assert_expected_server\|log_mt5_poll_server_verdict"` on the three service files | verdict line precedes the assert at every site; one assert per site, two in `mt5_read.py` | PASS |

mypy was not re-run (the SUMMARY records `Success: no issues found in 146 source files`; the fix round after it changed two service files, and the CI result on PR #1374 is the authority).

## Probe Execution

SKIPPED: the phase declares no probe scripts under `scripts/*/tests/probe-*.sh`.

## Requirements Coverage

| Requirement | Plans | Status | Evidence |
|-------------|-------|--------|----------|
| ONCE-01, CONN-01 | 05, 07, 08, 11, 18, 21 | SATISFIED in code; poll-path half and connect positive control await human items | connect refusals and draft answer shipped; poll reads now keep reads of two same-login accounts apart |
| ONCE-02 | 11 | SATISFIED | per-tenant index, per-owner pins |
| ONCE-03 | 02 | SATISFIED (record-based) | PROD census and delete, 0 same-owner duplicates after |
| ONCE-04, CONN-03 | 01, 06, 10, 12-17, 19, 21 | SATISFIED in code | server-qualified identity in SQL, Python and TS twins; index and reconcile agree |
| MT5D-08 | 04, 07, 09 | SATISFIED in code | `swap_account_slot` plus wizard and stamper wiring |

No orphaned requirements found; the roadmap lists exactly ONCE-01..04, CONN-01, CONN-03, MT5D-08.

## Anti-Patterns Found

Debt-marker scan over the nine plan-21 files was not exhaustive; the independent code review (`225-REVIEW-PR4.md`, round 2, status clean, 0 BLOCKER/HIGH/MEDIUM, six LOW/Info recorded in the review only per repo rule) is the record. Nothing found in this run's reads of the bracket sites.

## Prohibitions (flagged, never silently passed)

| ID | Statement | Tier | Disposition |
|----|-----------|------|-------------|
| P-225-21-01 | No MT5 poll stamps or persists numbers from a session that has not proved both login and server | judgment | Non-authoritative verdict: holds across all four production data-read sites in code and tests. FLAGGED `unverified-prohibition: human review recommended`; the authoritative check is plan 21 Task 3. |
| P-225-21-02 | No server value or login number reaches a refusal log line, `error_message` or `sync_error` | judgment | Non-authoritative verdict: holds by fixed message and key-id-only log lines. FLAGGED, human review recommended. |

## Human Verification Required

1. **Plan 18 Task 3 post-deploy positive control (founder).** In the PROD add-key form, for one working MT5 account, correct login, investor password and the CORRECT server. Expected: the 409 already-connected code. A transient answer means the bracket refuses correct sessions: stop and revert PR-2c. Why human: real credentials, PROD.
2. **Plan 21 Task 3 poll-cycle reading (orchestrator, post-deploy).** Read one daily cycle on Railway: verdict lines present, 0 False, 0 not_captured, 0 refusals, a True line for every live active MT5 key polled; zero lines is a STOP; the same holder refused on two consecutive cycles means revert. Why human: needs deploy and Railway access.
3. **Route the handed-back findings SF-M1 and SF-M4** (validation path, `services/mt5_probe.py`, `routers/exchange.py`) to an owner. A routing decision.

## Gaps Summary

No gaps. No truth FAILED. The phase goal is delivered in code: the connect refusals, the per-owner index, the server-qualified identity in all twins, the swap, and, with plan 21, the enforcing server bracket at all four MT5 poll read sites. The status is `human_needed` because two post-deploy human/orchestrator readings are open (plan 18's positive control, plan 21 Task 3) and two judgment-tier prohibitions are flagged. Phase 225 should not be marked complete until both readings are recorded.

---

_Verified: 2026-11-26_
_Verifier: Claude (gsd-verifier)_
