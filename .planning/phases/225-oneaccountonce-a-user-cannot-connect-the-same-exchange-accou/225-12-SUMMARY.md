---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 12
subsystem: analytics-identity
tags: [account-identity, stamper, mt5, venue-server, backfill, census, conn-03, once-04]
requires:
  - phase: 225-06
    provides: normalise_venue_server, same_venue_server, pick_same_account_holder (Python twins)
  - phase: 225-09
    provides: _find_live_holder (full row), _settle_with_holder, StampOutcome swapped_holder
provides:
  - the daily poll captures an MT5 key's broker server from its session and stores it beside the login
  - an unstamped MT5 key's same-owner holder is found BEFORE the update (wildcard pre-check)
  - an already-stamped MT5 key with no server is backfilled (outcome server_backfilled)
  - docs/runbooks/venue-server-backfill (gate-A5 read-only census) for plan 10 Task 4
affects: [225-10]
tech-stack:
  added: []
  patterns: [one guarded update for a backfill, no data-reading DO guard]
key-files:
  created:
    - docs/runbooks/venue-server-backfill/census.sql
    - docs/runbooks/venue-server-backfill/README.md
  modified:
    - analytics-service/services/account_identity.py
    - analytics-service/tests/test_account_identity_stamper.py
key-decisions:
  - "The backfill update also filters on venue_account_id = the stored login, beside the plan's venue_server-null guard, so a login rotated between the read and the write can never receive the old session's server (T-225-29, one extra predicate)."
  - "For MT5 the server is the session's normalised server, falling back to the key's stored venue_server when the session's is blank; a ccxt key keeps reading its stored venue_server exactly as plan 09 did (null for every ccxt key)."
  - "A session whose login is absent or differs from the stored login logs one WARNING per poll naming the cause with no value, and writes nothing."
requirements-completed: [ONCE-04, CONN-03]
status: complete
actuals:
  tokens: 8600
  tasks: 2
  commits: 2
plan_head_before: 06daa409dd94d0d207de48fd37badf56c4858bf0
plan_head_after: dc5243cc28ea07abbd6900b75f248107cb5f357e
---

# Phase 225 Plan 12: The poll captures the MT5 broker server, and the gate-A5 census Summary

An unstamped MT5 key now writes its login and normalised broker server in one update after a pre-update wildcard holder check, a stamped key with no server is backfilled from its own session under a login-equality guard, and the orchestrator has a read-only census that decides whether the server index may ship.

## What was built

- **Task 1 (tracer), commit 9c239a2be.** `StampOutcome` gains `server_backfilled`. New `_mt5_session_server` reads `Mt5Session.server` through `normalise_venue_server` (no terminal call). New `_backfill_mt5_server`: login must equal the stored login (else one WARNING with the cause and no value, no write), a blank session server writes nothing, otherwise one update `{venue_server}` guarded by `id`, the stored login and `venue_server IS NULL`; a guard that matched no row is `skipped_already_stamped`; a 23505 propagates to the boundary's ERROR line (gate A5 must have caught that state). `_stamp` for an unstamped MT5 key runs `_find_live_holder(after_index_refusal=False)` before the update and settles through plan 09's `_settle_with_holder`; with no holder it runs one update that adds `venue_server` when known. The ccxt order is unchanged (update first, holder after a 23505). Module docstring, `_stamp` docstring and `stamp_account_identity` docstring describe the new outcome and the pre-check.
- **Task 2, commit dc5243cc2.** `census.sql` (three read-only SELECTs, each headed by its pass rule, token `{{PR2_DEPLOYED_AT}}` in Census 3) and `README.md` (marker first and stop rule, one query per MCP call, counts only, any non-pass blocks PR-3, how to read a non-zero Census 1).

## Tests

Eleven new test functions (eighteen cases with parametrisation) and several edited:

- new: pre-check before any update; different-server holder admitted then settled after the old index refuses; the swap receives the session's server; two owners on one login each stamp their own identity (both directions, with a table responder that applies the filters it is given); backfill; guard matched no row; server already set (left alone); login absent or differing (two cases); blank session server; backfill 23505 not swallowed; log hygiene across six paths for login, server and its lower-case form.
- edited: `ALLOWED_WRITE_COLUMNS` gains `venue_server`; the stamp, poll, failed-poll, slow-poll and length-cap cases expect `venue_server` in the stamp; the collision cases now expect the holder found before the update; the held-account poll case expects no login write.
- **Superseded pin, with a dated note quoting Q2:** `test_an_already_stamped_mt5_key_is_left_alone` became `test_an_already_stamped_mt5_key_without_a_server_is_backfilled`; a left-alone case remains for a key whose server is set. The file's old "server is NOT part of the identity (TODOS.md A-3)" comment is marked superseded and kept as lineage.

## Verification

- `pytest tests/test_account_identity_stamper.py tests/test_account_identity.py tests/test_venue_server_identity.py`: `255 passed`. Wider set (every other test file naming account_identity, plus `test_derive_allocator_equity_job.py` and `test_allocator_positions.py`): `490 passed, 3 warnings`.
- mypy line: `Success: no issues found in 142 source files` (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`, from `analytics-service/`).
- `ruff check services/account_identity.py tests/test_account_identity_stamper.py`: `All checks passed!`
- Census check: `test -f docs/runbooks/venue-server-backfill/census.sql && test "$(grep -a -v '^\s*--' ... | grep -a -ciE '\b(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b')" -eq 0`: passes. A scratch copy with one `UPDATE ... SET` line appended counts 1, so the check can fail. `grep -a -c PR2_DEPLOYED_AT census.sql` = 3.
- Acceptance greps: `grep -a -c "server_backfilled" account_identity.py` >= 2 (met); `grep -a -c '"venue_server"' test_account_identity_stamper.py` >= 1 (met).

## PROOF-01 record (neuter, RED, byte restore, GREEN)

Backup: `cp analytics-service/services/account_identity.py <scratchpad>/account_identity.py.bak`. Each neuter restored with `cp` and checked with `cmp` (silent every time). No git checkout, restore or stash.

- **Neuter B**, the MT5 pre-check dropped (`holder = None` in place of the look-up). RED, `5 failed, 153 passed`: `FAILED ...::test_an_unstamped_mt5_key_finds_its_null_server_holder_before_any_update`, `...::test_an_mt5_holder_on_another_server_is_admitted_then_settled_after_the_index_refuses`, `...::test_two_owners_keys_on_one_mt5_login_each_stamp_their_own_identity[first-owner-stamps]`, `[second-owner-stamps]`, `...::test_an_mt5_done_poll_on_a_held_account_audits_the_duplicate_once`. `cmp` silent. GREEN: `255 passed` (three files).
- **Neuter C**, the login-equality guard on the backfill dropped (`if False:` in place of `_mt5_account_id(session) != stored_login`). RED, `2 failed, 156 passed`: `FAILED ...::test_a_backfill_never_uses_a_session_of_another_login[80000099]`, `[None]`. `cmp` silent. GREEN: `255 passed`.
- **Neuter G** (added, T-225-37), the `.eq("user_id", ...)` line removed from the holder read. RED, `5 failed, 153 passed`: `FAILED ...::test_collision_with_a_live_sibling_marks_the_key_and_never_acts_on_it`, `...::test_mt5_collision_marks_the_key_duplicate_and_audits_once`, `...::test_two_owners_keys_on_one_mt5_login_each_stamp_their_own_identity[first-owner-stamps]`, `[second-owner-stamps]`, `...::test_a_working_key_takes_the_slot_from_the_owners_failing_holder`. `cmp` silent. GREEN: `255 passed`.
- **Neuter H** (added), the `venue_server IS NULL` guard removed from the backfill update. RED, `1 failed, 157 passed`: `FAILED ...::test_an_already_stamped_mt5_key_without_a_server_is_backfilled`. `cmp` silent. GREEN: `255 passed`, `490 passed` wider set, mypy `Success: no issues found in 142 source files`.

The behaviour tests were written first and run against the plan 09 code: 18 failed, 140 passed, before the implementation was added.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Backfill update also guards on the stored login**
- **Found during:** Task 1 design (T-225-29).
- **Issue:** The plan guards the backfill update with `venue_server IS NULL` only. A rotation that changes `venue_account_id` between the read and the write would then receive the old session's server.
- **Fix:** one more predicate, `.eq("venue_account_id", stored_login)`, on the same update. Pinned only through the equality check on the login read (Neuter C); the predicate itself is not separately neutered.
- **Files modified:** analytics-service/services/account_identity.py
- **Commit:** 9c239a2be

### Notes

- The plan's `<verify>` runs the three test files and mypy; both were run, plus the wider account_identity set.
- Task 1 is `type="tracer"`; its verify block (pytest set and mypy strict) ran end to end and passed before Task 2 started.
- Plan 09's two collision test doubles still work unchanged: `_mt5_collision_responder` returns a null-server holder, which the new pre-check now finds, so those cases no longer reach the 23505 branch for MT5. That branch is covered for MT5 by the new different-server case and for ccxt by the existing cases.
- No `<threat_model>` mitigation was skipped: T-225-29 (Neuter C, H), T-225-30 (the six-path log test), T-225-37 (Neuter G and the two-owner cases), T-225-38 (census check, mutant counts 1).

## Known limits

- **Not run on PROD.** The census was not run: executors have no PROD access. Plan 10 Task 4 owns it, behind the marker query.
- An MT5 key whose session cannot be built is never backfilled, an inactive key is never polled, and sFOX has no identity; those keys carry no identity link until they stamp (the plan's edge note). Census 1 reports the first two by cause class.
- A stamped key whose session login differs from the stored login logs the WARNING on every poll until the rotate or reconnect path fixes it.
- Between this plan and plan 10, the login-only index is still live: a same-login key on a different server is refused by the index and settled by the interim after-refusal rule.

## Ship notes for PR-2

- 155.2 freeze: stamping an unstamped MT5 key writes its login and can route into plan 09's swap, so the orchestrator re-checks the freeze before PR-2 opens and again immediately before it merges (precondition held at execution: `155.2-12-SUMMARY.md` absent).
- TODOS.md `A-3` (the MT5 identity is the login alone) is not closed by this plan: the index change (PR-3) is what closes it. The ship that carries PR-3 deletes it; do not tick it here.
- Plan 10 Task 4 consumes `docs/runbooks/venue-server-backfill/census.sql` as gate A5.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; the poll writes `api_keys.venue_server` through the existing service-role client, and the census is read-only.

## Self-Check: PASSED

Files present: `analytics-service/services/account_identity.py`, `analytics-service/tests/test_account_identity_stamper.py`, `docs/runbooks/venue-server-backfill/census.sql`, `docs/runbooks/venue-server-backfill/README.md`. Commits 9c239a2be and dc5243cc2 are ancestors of HEAD on `worktree-agent-225-12`. No STATE.md or ROADMAP.md change.
