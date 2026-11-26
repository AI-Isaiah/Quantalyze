---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 14
subsystem: analytics-service
tags: [identity, mt5, venue_server, derive, match-scorer, CONN-03]
requires: []
provides:
  - server-aware account_identity_tokens and ambiguous_server_key_ids
  - DeriveRefusal.ACCOUNT_SERVER_AMBIGUOUS (account_server_ambiguous)
  - the `tokens` section of venue_server_identity.json (replayed by plan 15's TS)
affects: [225-15, 225-16, 225-17]
tech-stack:
  added: []
  patterns: [canonical identity per key, never a pairwise wildcard]
key-files:
  created: []
  modified:
    - analytics-service/services/allocator_equity_derive.py
    - analytics-service/services/job_worker.py
    - analytics-service/routers/match.py
    - analytics-service/tests/fixtures/venue_server_identity.json
    - analytics-service/tests/fixtures/derive_refusal_rows.json
    - analytics-service/tests/test_venue_server_identity.py
    - analytics-service/tests/test_derive_allocator_equity_job.py
    - analytics-service/tests/test_match_portfolio_aum_per_key.py
key-decisions:
  - "CONTEXT Q6 item 1: one login on two set servers is two accounts, never one token"
  - "CONTEXT Q6 agent decision: a server-less key joins its login only while the login has at most one distinct set server; otherwise it has no token and the derive refuses by name"
  - "New refusal token account_server_ambiguous, not account_identity_collision; owner sees the generic derivation_rejected line"
requirements-completed: [CONN-03]
status: complete
commits: 3
plan_head_before: 5647b4e56bf1ebaad77dd18eff907462a2487ccf
plan_head_after: 0d76d7464171b15e9e33e0c9548d29d95f008f77
actuals:
  tokens: 10600
  tasks: 3
  commits: 3
---

# Phase 225 Plan 14: Python twin of the server-aware account identity Summary

One MT5 login on two broker servers is now two accounts in the derive and in the match scorer, and a key with no server on a login that carries two or more servers stops the derive by its own name (`account_server_ambiguous`), live or disconnected.

## What was built

- `allocator_equity_derive.py`: private `_login_identities` computes each key's `(exchange_key, login, canonical server)` or `None` plus the ambiguous ids, from the plan's RULE (a canonical identity per key, never a pairwise wildcard, because union-find is transitive). `ambiguous_server_key_ids(keys)` is public. `account_identity_tokens` unions on the identity tuple; the marker pass, the `account:<smallest id>` token and the root choice are unchanged. A server counts only as a non-empty `str`; nothing is trimmed or folded.
- `job_worker.py`: `_load_keys` selects `venue_server`; the identity gate calls `ambiguous_server_key_ids(key_rows)` before the collision check and refuses with `DeriveRefusal.ACCOUNT_SERVER_AMBIGUOUS` (one Sentry warning tagged `compute_job_id` and `derive_refusal`, one WARNING log with the token, allocator id and a count only).
- `routers/match.py`: the scorer's `api_keys` select carries `venue_server`; an unplaceable server-less key is its own `key:<id>` group (the scorer's existing treatment of an unknown key).
- `venue_server_identity.json`: a hand-typed `tokens` section (17 cases) and the rule in `_comment`. `derive_refusal_rows.json`: one `refusals` row for the new token, `reader_reason` `derivation_rejected`, and the live-member count in `notes` moved from 7 to 8.

## Refusal-token decision (restated)

A NEW `DeriveRefusal` member, not `ACCOUNT_IDENTITY_COLLISION`: (1) CONTEXT asks for "a named reason" and the collision's definition ("two live keys read one account") is false here; (2) the collision's reader line tells the owner to disconnect a key, which would not clear a key that is already disconnected. Enumeration cost was small: no SQL CHECK or enum constrains a refusal token, and `untrustworthyRebuildReason` and the census CASE map an unknown token to `derivation_rejected` through their ELSE arms, so no reader code changed.

## Owner line acceptance (restated)

The owner sees the generic `derivation_rejected` line ("did not pass its checks ... use the contact form"), not a delete-the-key hint (orchestrator advisory 5, accepted as planned). A specific hint needs a new reader_reason in `untrustworthyRebuildReason`, a new census CASE arm, copy and a changed fixture row with three set-equality tests. The 2026-11-25 sizing found 0 owners on PROD in that state; plan 17 Task 3 step 4 re-measures 0 ambiguous keys before PR-2b-2 merges. Exits: a live ambiguous key gets its server from its next successful poll (plan 12's backfill); a disconnected one clears only when the key is deleted.

## Task commits

| Task | Commit | Result |
|------|--------|--------|
| 1 (tracer) | 7e9626af0 | server-aware tokens, `_load_keys` select, fixture `tokens` section, end-to-end derive test |
| 2 | c6937564b | `account_server_ambiguous` refusal, fixture row, three behavior tests |
| 3 | 0d76d7464 | scorer select and docstring, three scorer tests |

The tracer's verify was green (433 passed, mypy clean) before Tasks 2 and 3 started.

## Proof the tests can fail (PROOF-01)

Every neuter was made on a file whose byte copy was kept in the session scratchpad, then restored and verified identical with `cmp`.

| Neuter | Result |
|--------|--------|
| T1 (a): delete `venue_server` from `_load_keys`'s select | `1 failed, 190 deselected` (`test_two_live_keys_on_one_login_and_two_servers_compose_as_two_accounts`: a refusal row where a composed curve was expected) |
| T1 (b): union key reverted to a login-only identity (canonical server forced to `''`) | `15 failed, 20 passed, 260 deselected` across `test_two_live_keys...` and `test_account_identity_tokens_and_ambiguity` |
| T2 RED-first (new tests run against the Task 1 tree, before the gate) | `2 failed, 1 passed`: both `ambiguous` arms (live, disconnected) composed instead of refusing; test (iii) passed because it is already true at Task 1 |
| T3 RED-first (before the select change) | `3 failed, 11 passed` |
| T3 neuter (drop `venue_server` from the scorer select) | `3 failed, 11 passed` |

## Verification at final HEAD (0d76d7464)

- Consolidated pytest from `analytics-service/` over the plan's files (`test_venue_server_identity`, `test_derive_allocator_equity_job`, `test_allocator_equity_departed`, `test_derive_refusal_rows`, `test_match_portfolio_aum_per_key`, `test_match_portfolio_aum_native_unpriced`, `test_match_router`): `602 passed, 5 warnings`.
- mypy, the CI `python` job's command verbatim (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 143 source files`.
- vitest consumers of the fixtures and of the refusal token: `src/lib/venue-identity.test.ts`, `src/lib/queries.test.ts`, `src/lib/__tests__/derive-refusal-rows.test.ts`, `src/__tests__/accounttruth-census.test.ts` gave `4 passed (4) / 332 passed`; `holding-scope-key-census.test.ts`, `seam-venue-vocabulary.invariant.test.ts`, `queries.test.ts` gave `3 passed / 233 passed`.
- Acceptance greps (`grep -a -c`): `def ambiguous_server_key_ids` 1; `"exchange,venue_account_id,venue_server,"` 1; `"tokens"` 18 (>= 1); `ACCOUNT_SERVER_AMBIGUOUS = "account_server_ambiguous"` 1; `"token": "account_server_ambiguous"` 1; `ambiguous_server_key_ids(key_rows)` 1; the scorer select literal 1.
- Other readers: the only callers of `account_identity_tokens`, `identity_pending_venues` and `departed_history_inclusion` in `services/` and `routers/` are the derive (which reads `key_rows` from the now-wider `_load_keys`) and the scorer; no caller reads `api_keys` through a narrower select.

- Full `analytics-service` suite at HEAD (`python3 -m pytest tests -q -x`): `1 failed, 16708 passed, 93 skipped, 4101 warnings in 964.39s (0:16:04)`. The one failure is `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`: its subprocess runs `pytest -n 2 --dist loadgroup` and this machine's Python has no pytest-xdist (`error: unrecognized arguments: -n --dist`). It is environmental and unrelated to this plan. `-x` stopped the run there, so the only file sorting after it, `tests/test_zavara_acceptance.py`, was run separately: `23 passed`. The full run is therefore not a clean all-green: it is green except that one xdist-dependent test.

## Deviations from Plan

### Auto-added

**1. [Rule 2 - Missing coverage] Four extra `tokens` cases**
- **Cases:** `blank-login-is-unknown`, `login-is-stripped`, `empty-server-is-no-server`, `server-is-compared-as-stored`, beyond the plan's list of at least twelve.
- **Why:** each follows from a clause of the RULE (blank login has no identity; login stripped; NULL or empty is no server; nothing trimmed or case-folded in the reader). They have no SQL arm of the same name in plan 16, so plans 15 and 16 must satisfy them. `accountIdentityTokens` in `src/lib/departed-history.ts` already strips the login and the exchange (`venue.trim()`, `exchange.trim().toLowerCase()`), so `login-is-stripped` is not new work for plan 15. `server-is-compared-as-stored` (srv-a vs SRV-A are two accounts) is the one a SQL `lower()` would trip, so plan 16 should check it.
- **How produced:** every expectation was typed as a literal from the rule and serialised by a throwaway script, never produced by either implementation.

**2. [Rule 3 - Branch namespace] Commit-time agent-branch allow-list not applied**
- The worktree branch is `gsd/phase-225-pr2b-2`, a caller-designated plan worktree off the phase branch, not an `agent-*` branch. The protected-branch assertion passed (HEAD is attached, not on a default branch); the `agent-*` allow-list was not applied because the caller named this branch.

**3. State and ROADMAP handlers skipped on instruction**
- Per the caller, `STATE.md` and `ROADMAP.md` were not edited, no `state.*`, `roadmap.*` or `requirements.mark-complete` handler ran, and the SUMMARY is committed by explicit `git add`, not `gsd query commit`.

Test (iii) passing already at Task 1 is expected, not a deviation: it states today's behaviour for a login with one set server.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; the refusal log and Sentry event carry the token, allocator id and a count only (T-225-44).

## Self-Check: PASSED

- Commits 7e9626af0, c6937564b, 0d76d7464 are ancestors of HEAD.
- All eight modified files exist and are committed.
