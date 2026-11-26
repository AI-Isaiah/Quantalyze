---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 18
subsystem: analytics-mt5-validation
tags: [mt5, validation, broker-server, run-probe, conn-03, once-01, q6]
requires:
  - phase: 225-06
    provides: normalise_venue_server and the server-aware identity readers
provides:
  - run_probe proves the broker server the session is on, beside the login (assert_expected_server)
  - Mt5ServerMismatchError, a subclass of Mt5AccountMismatchError, disposed of as transient by the wizard and propagated untouched by the worker adapter
  - tests pinning that the stored venue_server is the validated passphrase on both TS connect routes
affects: [225-19]
tech-stack:
  added: []
  patterns: [one account_info snapshot judged by both brackets, subclass of an existing disposition instead of a new except arm]
key-files:
  created: []
  modified:
    - analytics-service/services/mt5_probe.py
    - analytics-service/services/mt5_client.py
    - analytics-service/tests/test_mt5_validate.py
    - analytics-service/tests/test_mt5_client_contract.py
    - analytics-service/tests/test_ingestion_mt5.py
    - analytics-service/tests/test_mt5_validate_parity.py
    - analytics-service/tests/test_long_fetch.py
    - analytics-service/tests/test_mt5_validation_park.py
    - analytics-service/tests/test_validate_key_permanent_400.py
    - src/app/api/keys/validate-and-encrypt/route.test.ts
    - src/app/api/strategies/create-with-key/route.test.ts
key-decisions:
  - "Mt5ServerMismatchError subclasses Mt5AccountMismatchError, so both callers' existing except arm (transient, no park, never valid, never user-blamed) applies with no new arm; its message is fixed and carries only the login."
  - "The server compares through normalise_mt5_server (trim + casefold), the known-server pre-check's own normaliser; a missing, non-string or blank server fails closed."
  - "No route file changed: both TS connect routes already validated the exact passphrase they store."
requirements-completed: []
status: partial
actuals:
  tokens: 9600
  tasks: 2
  commits: 2
plan_head_before: 5ef1cff15d018dcf663bb2d53df2b35d00c50ae8
plan_head_after: 001535035ca7b830f48efcbe6c91a93a6425ada5
---

# Phase 225 Plan 18: MT5 validation proves the broker server, not only the login Summary

`run_probe` now brackets the terminal session with a new `assert_expected_server` beside every `assert_expected_login`, so a validation stores nothing unless the session it opened is on the requested login AND the requested broker server. Tasks 1 and 2 are done and committed. Task 3 (Railway log evidence, the founder's wrong-server attempts, the 155.2 freeze check) is a human checkpoint and is PENDING: this plan is not complete until the orchestrator records it, and `requirements-completed` is left empty for that reason.

## What was built

- **Task 1 (tracer), commit bfc562127.**
  - `Mt5ServerMismatchError(Mt5AccountMismatchError)` in `services/mt5_client.py`: fixed message, `expected` and `actual` both the login int, no server or password ever carried.
  - `assert_expected_server(info, *, login, server)` in `services/mt5_probe.py`, called in `run_probe` after the PRE login check and at both POST sites. The two POST sites previously called `client.account_info()` inline twice; each now reads it once into `post` and judges login and server on that one snapshot.
- **Task 2, commit 001535035.** Tests only. The worker adapter needed no code (it calls `run_probe`). Fakes across the suites that reach `run_probe` now report the requested server. Both TS connect routes are unchanged.

## MT5 venue API docs relied on (read 2026-11-25 by the plan author; this executor relied on the plan's reading of them and on nothing they do not say)

- https://www.mql5.com/en/docs/python_metatrader5/mt5login_py: `login(login, password=, server=, timeout=)`; server is optional and "if no server is set, the last used server is applied automatically"; the return is True on a successful connection, otherwise False. Relied on for: the server keyword must reach `login()` (pinned by `test_login_passes_the_requested_server_to_mt5`), and a True return proves nothing about which server the terminal ended up on.
- https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py: with no server, the one saved in the terminal database for the account is applied; silent on a terminal that is already connected.
- https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py: `account_info()` returns a named tuple with `login` and `server` fields, or None on error. Relied on for: the session's own `server` is the proof compared with the request.
- https://www.mql5.com/en/docs/python_metatrader5/mt5lasterror_py: error-code table. No code quoted; `services/mt5_validation.py` stays authoritative.
- NOT documented and NOT assumed: that a wrong server makes `login()` return False, and what `login()` does when the terminal already holds that login on another server. The bracket makes the answer irrelevant to what is stored. The observations fixture `mt5_login_rejection_observations.json` was not touched (Task 3 owns it) and still holds no measured pair.

## RED evidence (failing-first)

Run before the change, on the new tests in `tests/test_mt5_validate.py`:

- (a) `test_mt5_session_on_another_server_fails_closed_transient`: RED. Before the change the router answered `{valid: true}`.
- (d) `test_mt5_session_reporting_no_server_fails_closed_transient[absent|None|""|"   "]`: all four RED.
- `test_mt5_server_changing_after_the_probe_fails_closed_transient` (POST bracket): RED.
- (c) `test_mt5_server_spelling_differing_only_by_case_and_space_passes`: passed before the change, as designed, and goes RED when the normaliser is replaced by raw equality (`_reported != server`), so it can fail.
- (b) is two tests. `test_mt5_login_refused_by_a_wrong_server_is_a_permanent_refusal` and its positive control `test_mt5_login_against_the_accounts_own_server_validates` pin the router's disposition of a refused login, which already held before the change, so they are not RED-first. That the server reaches MetaTrader5's own `login()` is `test_login_passes_the_requested_server_to_mt5` (no existing contract test asserted the `server=` keyword, so it is new). RED shown by deleting `server=server` from the `login()` call in `services/mt5_client.py` on a byte copy: `KeyError: 'server'`; the file was restored from the byte copy and compared equal.
- Neuter after the fact (byte copy of `mt5_probe.py`, `assert_expected_server` returning immediately): 11 tests red across `test_mt5_validate.py` (6), `test_ingestion_mt5.py` (4) and `test_mt5_validate_parity.py` (1); restored byte-equal.
- TS neuter (byte copies of both route files, `validateKey` handed a constant instead of the request passphrase): the new "validateKey is handed the request's own passphrase" case in each route test file goes red; restored byte-equal.

A deviation in test design: the first draft of (b) used `srv-other` as the wrong server. The known-server pre-check (`assert_mt5_server_known`) refused it first (424, server unknown), which is not the case under test. The wrong server in (b), and the other-server in (a), is now `MyBroker-Live`, a sibling server the suite's `conftest.py` list admits, which is exactly the scenario the plan targets (same broker, wrong server, passes the pre-check). The first draft of (b) also ran its positive control in the same test; a second `_call` in one test hit the terminal-scrub owed gate, so the control is its own test.

## Per behavior bullet (Task 2)

| Behavior | Test |
|---|---|
| Adapter propagates the mismatch, never a valid result or an auth/wrong-server verdict | `test_ingestion_mt5.py::test_validate_session_not_on_the_requested_server_propagates_the_mismatch` (another / none / empty / blank) |
| Router and adapter dispose of it the same way | `test_mt5_validate_parity.py::test_a_session_on_another_server_is_refused_the_same_way_on_both_paths` (new; the roster `test_mt5_probe_parity_roster.py` is structural and enumerates no mismatch kinds, so it needed no row) |
| validate-and-encrypt: validated passphrase is the stored venue_server | new `225-18: validateKey is handed the request's own passphrase, and the inserted venue_server is that same value normalised`; existing `forwards all THREE mt5 slots to validateKey then encryptKey on the happy path` and `an MT5 add with no holder writes the trimmed login and the NORMALISED server` cited |
| create-with-key: same, with `p_venue_server` | new `[225-18] validateKey is handed the request's own passphrase, and p_venue_server is that same value normalised`; existing `no holder: the normalised server rides beside the login (trim + lower-case)` cited |
| A validateKey refusal stores nothing on either route | new `it.each` (auth refusal, transient answer to a session on another server, wrong-server refusal) and a not-read-only case in both files: no insert, no RPC, no encrypt |
| No MT5 arm stores without a prior validateKey; rotate-secret accepts no server | validate-and-encrypt has one store arm and validation precedes the encrypt (call-order assertion); create-with-key: new replay test (an existing draft for the session answers `deduped` with no validate, no encrypt, no RPC, whatever server the body names) and new reuse test (a reuse request carrying a login and a server still sends exactly the four fixed RPC args); the pre-validation fence arms (draft, connected, orphaned) are existing refusal tests. `rotate-secret/route.ts` read only: its header and body type carry no login or server field (D-03). |

**Route files changed: none.** No test exposed an MT5 path that stores without validating or stores a server other than the validated passphrase.

## Extra test files edited because their fake account lacked a server

Three files beyond the plan's list (the plan's limit was four): `analytics-service/tests/test_long_fetch.py`, `analytics-service/tests/test_mt5_validation_park.py`, `analytics-service/tests/test_validate_key_permanent_400.py`. Found by running the whole `-k mt5` selection plus the non-`mt5`-named files that reach `run_probe` (`test_validate_key_venue_transient.py`, `test_status_contract_exchange_internal.py`, `test_process_key.py`, `test_structlog_frozen_proxy.py`, `test_mt5_abandon_fence.py`: all green unchanged).

## Verification (verbatim)

- `cd analytics-service && python3 -m pytest -q -k "mt5" -p no:cacheprovider`: `2957 passed, 1 skipped, 13782 deselected, 646 warnings in 122.60s`. The one skip is the pre-existing one (the same single skip appears before any change).
- `python3 -m pytest tests/test_mt5_validate.py tests/test_mt5_client_contract.py tests/test_ingestion_mt5.py tests/test_mt5_validate_parity.py tests/test_mt5_probe_parity_roster.py -q -p no:cacheprovider`: `499 passed, 1 skipped, 24 warnings in 61.23s`.
- `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (exactly the CI `python` job command): `Success: no issues found in 143 source files`.
- ruff: CI does not run it (`grep -c ruff .github/workflows/ci.yml` is 0). Run anyway on the two source files: `All checks passed!`.
- `npx vitest run src/app/api/keys/validate-and-encrypt/route.test.ts src/app/api/strategies/create-with-key/route.test.ts`: `Test Files  2 passed (2)`, `Tests  370 passed (370)`.
- Acceptance greps: `def assert_expected_server` count 1; `assert_expected_server(` count 4 (definition plus three call sites; the plan said at least 4); `class Mt5ServerMismatchError(Mt5AccountMismatchError)` count 1; `Mt5ServerMismatchError` appears in `test_ingestion_mt5.py`.

## Deviations from Plan

- **[Rule 3 - test design]** (b) split into two tests and moved to `MyBroker-Live` as the other server, for the reasons above. Not a behavior change.
- **Ship guard note.** `git diff --name-only origin/main...HEAD | grep -c '^.planning/'` prints 18 on this execution branch, because the branch's first commit carries the phase's plans and CONTEXT. The PR-2c branch is cut through the house `-pr` filter; the count must be re-run to print 0 on that branch before the push. Nothing was pushed here.
- No other deviation. STATE.md and ROADMAP.md were not edited, nothing was pushed, no PR was opened.

## PENDING CHECKPOINT: Task 3 (waiting on the orchestrator and the founder; NOT done by this executor)

Precondition: Tasks 1 and 2 committed (done) and PR-2c's CI green on its head SHA (not yet pushed). Gate: `blocking-human`. Nobody writes a login, server or password anywhere.

1. Orchestrator, read-only: read the analytics service's Railway logs for the relogin keepalive's `session_server_matches_env=` verdict lines over the last 7 days. Record the counts of `=True`, `=False` and `not_captured`. Every captured verdict must be True. Any False, or none captured: STOP, do not merge PR-2c, report to the founder.
2. Founder, BEFORE the merge, one step, in the product on PRODUCTION: in the allocator's add-key form (AllocatorExchangeManager, which posts to validate-and-encrypt) for one of their own MT5 accounts whose existing key is currently WORKING (synced, not disconnected), enter the correct login and investor password with a WRONG server of the same broker (a sibling on the curated list). Read out the answer. A wrong-server or auth code means validation refused it. The duplicate-account code means validation ADMITTED the wrong server and only the index stopped it.
3. Orchestrator: record the verdict (code and reading) here. If the founder captured the terminal's (code, text) pair, append one synthetic observation to `analytics-service/tests/fixtures/mt5_login_rejection_observations.json` under its `_protocol` (synthetic label, server as a placeholder, expected class `wrong_server` or `auth`), then run `cd analytics-service && python3 -m pytest tests/test_mt5_validate.py -q -k observation`.
3b. At merge time on main: `ls .planning/phases/155.2-*/155.2-12-SUMMARY.md .planning/phases/155.2-*/155.2-14-SUMMARY.md`. If plan 12's SUMMARY exists and plan 14's does not, the 155.2 freeze is active: STOP and report to the founder before merging.
4. PR-2c merges once step 1 and 3b hold, whatever step 2 showed. After its Railway deploy is live (analytics `/health` reports the merge SHA), the founder repeats step 2 once: the answer must be a validation refusal (wrong-server, auth or transient), neither success nor the duplicate code. Then the POSITIVE CONTROL: same form, same working account, the CORRECT server: it must answer the 409 already-connected code. A transient answer there means the bracket refuses correct sessions: STOP and revert PR-2c. If the wrong-server repeat is not a validation refusal, PR-3 must not merge (plan 19 checks this record).

Recorded results (to be filled by the orchestrator; no identifiers or credentials): log verdict counts: _pending_; pre-deploy attempt code and reading: _pending_; post-deploy wrong-server code: _pending_; post-deploy correct-server control: _pending_.

**Wrong-server measurement, recorded 2026-11-25 (coordinator decision: this IS the plan 19 Task 3 step 6 measurement, and no repeat after deploy is required).** The founder made two attempts in the PROD add-key form, on main v0.133.79.1 with PR-2c not deployed. Both used one real MT5 account and its real investor password, on a sibling live server of the same broker that is not the account's stored server.
- Both reached the validation terminal. `login()` answered in 344 ms and 523 ms, with `last_error` -6 both times (`RES_E_AUTH_FAILED`, "authorization failed", per the MT5 Python docs).
- Both were refused at the login stage with HTTP 424 `SIGN_IN_FAILED`, which the wizard showed as `KEY_SIGN_IN_FAILED`. 0 keys were stored.
- A third attempt, on the right server, was refused with `KEY_ORPHANED` before any validation call. That is correct: the signed-in user already holds that account.
- Reading: the existing validation already refuses a wrong server at the broker's authorization step. PR-2c's session-server check remains defence in depth (225-CONTEXT.md Q6). Log verdict counts stay pending until the plan 20 Task 3 read.

**Third wrong-server attempt, recorded 2026-11-26 (relayed by the main session; no identifiers here).** Around 10:08Z on PRODUCTION the founder tried one of their own MT5 accounts with a sibling live server of the same broker that IS on the known-server list.
- The broker refused the sign-in: the wizard showed `KEY_MT5_SIGN_IN_REFUSED`. 0 keys were stored. Correlation id `wizard:fac935c1-7c6e-4bc6-b896-8d4a6101235d`.
- Most likely pre-#1344-deploy. Measured on Railway: PR-2c's merge commit `2aa1a0cbb` deployed to the worker service at 10:07:12Z, while the analytics service's deployment of that SHA was still `WAITING` on main CI, and its live deployment was `c7e1fe682` (v0.133.87.0). So the refusal came from the broker's authorization step, not from PR-2c's session-server bracket, the same reading as the 2026-11-25 attempts.
- Two earlier attempts the same morning used server names NOT on the known-server list. Both were stopped before any broker call with `KEY_MT5_SERVER_UNKNOWN`, which is correct.
- Reading: a wrong server is refused before storage on every path measured so far (pre-broker for an unknown name, at the broker's sign-in for a known sibling). The post-deploy positive control (the CORRECT server must answer the already-connected code, not a transient) is still not recorded.

## CHANGELOG theme for PR-2c

The MT5 validation now proves the broker server the session is on, not only the login: a key is never stored with a server its validation session did not prove. Section vocabulary: `### Fixed` (a session on another server no longer validates), `### Tests` (server bracket on the wizard, the worker adapter and both TS connect routes), `### Notes` (the MT5 docs leave the already-connected case open; the bracket makes that irrelevant; Task 3's founder evidence pending). No `TODOS.md` entry is closed by this plan.

## Known Stubs

None.

## Threat Flags

None. `Mt5ServerMismatchError` carries a fixed message and the login int only (T-225-59); the compare is casefold-normalised and disposes as transient (T-225-60); the stored server is pinned to the validated passphrase (T-225-58).

## Self-Check: PASSED

- FOUND: `analytics-service/services/mt5_probe.py` (`def assert_expected_server`), `analytics-service/services/mt5_client.py` (`class Mt5ServerMismatchError`)
- FOUND commits: bfc562127, 001535035 (both ancestors of HEAD)
