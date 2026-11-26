---
phase: 240-connecttruth-validating-a-key-or-a-csv-gets-a-true-answer-an
plan: 03
subsystem: analytics-service validate-key error contract
tags: [conn-05, validate-key, error-contract, sfox, mt5, parity-fixture]
requires: []
provides:
  - "eight validate-key 400 arms answer the flat {detail, code, recoverable} body with recoverable false"
  - "validate_key_permanent_400_contract.json, a committed cross-language fixture (pytest driver + vitest reader)"
affects: [240-05]
tech-stack:
  added: []
  patterns: ["VenueTransientHTTPException at status 400 for permanent credential arms", "named-and-driven fixture census read from the test module's own AST"]
key-files:
  created:
    - analytics-service/tests/test_validate_key_permanent_400.py
    - analytics-service/tests/fixtures/validate_key_permanent_400_contract.json
    - tests/lib/validate-key-permanent-400-parity.test.ts
  modified:
    - analytics-service/routers/exchange.py
    - analytics-service/tests/test_raw_5xx_census.py
decisions:
  - "Harness imported by name from tests.test_validate_key_venue_transient (app_client, _handler_globals, _post_validate_key, _arrange_sfox, _arrange_mt5, _MT5_FIELDS): no collection side effect, because no test_ name is imported"
  - "test_raw_5xx_census.py pin moved 15 -> 23 sites and its status set widened to {400, 424} (blocking, Rule 3)"
metrics:
  duration: "about 25 minutes"
  completed: 2026-11-24
status: complete
estimate:
  tokens: 70000
  raw_tokens: 70000
  tasks: 2
  confidence: low
actuals:
  tokens: 9750
  tasks: 2
  commits: 2
plan_head_before: c37593fa674a3d5a02a8cbf30ea8b03d69a03790
plan_head_after: 30ea0092d66306b0f593deb085c0f568168543ba
---

# Phase 240 Plan 03: Flat coded 400 on the rostered-code validate-key arms Summary

Eight validate-key 400 arms (sFOX 401/403, blank token, control-character token; MT5 credential parse wrong_server and auth, MT5 login classified auth and wrong_server, MT5 master password) now raise `VenueTransientHTTPException(status_code=400, code=..., detail=<same constant>, recoverable=False)`, so one condition has one body on every venue and the wizard verdict is unchanged.

`actuals.commits` is measured over the two task commits (`plan_head_before..plan_head_after`); the SUMMARY commit that follows is not counted in it.

## What changed

| Site | Venue | Code | Detail constant (unchanged) |
|---|---|---|---|
| P1 | sFOX 401/403 | AUTH_FAILED | AUTH_FAILED_DETAIL |
| P2 | sFOX blank or whitespace token | AUTH_FAILED | AUTH_FAILED_DETAIL |
| P3 | sFOX control-character token | AUTH_FAILED | AUTH_FAILED_DETAIL |
| P4 | MT5 credential parse, wrong_server | MT5_WRONG_SERVER | MT5_WRONG_SERVER_DETAIL |
| P5 | MT5 credential parse, auth | AUTH_FAILED | AUTH_FAILED_DETAIL |
| P6 | MT5 login classified auth | AUTH_FAILED | AUTH_FAILED_DETAIL |
| P7 | MT5 login classified wrong_server | MT5_WRONG_SERVER | MT5_WRONG_SERVER_DETAIL |
| P8 | MT5 master (trade-capable) login | MT5_MASTER_PASSWORD | MT5_MASTER_PASSWORD_DETAIL |

Every `code=` is a literal keyword string at the raise site. Every preceding `trace.outcome` assignment is kept. The go-dark gates, `create_exchange` arm and `fetch_trades` are untouched (plan 05 owns the first two). `raise HTTPException(status_code=400` count in `routers/exchange.py`: 11 at HEAD, 10 after Task 1, 4 after Task 2 (the master arm was a multi-line raise and is not in that count; the four left are the two go-dark gates, `create_exchange` and `fetch_trades`). `code="MT5_MASTER_PASSWORD"` count 1, `code="MT5_WRONG_SERVER"` count 2.

Tests: 14 wire tests through `main.app` (one per arm, plus 401/403 and blank/whitespace parametrisation, plus the sFOX/MT5 adjacency test, plus the cross-artifact copy pin and the named-and-driven census). The TS reader replays the real classifier for the coded body and the HEAD-shape body (same detail, no code) and asserts equal verdicts and equal envelopes: AUTH_FAILED -> KEY_AUTH_FAILED, MT5_WRONG_SERVER -> KEY_MT5_WRONG_SERVER, MT5_MASTER_PASSWORD -> KEY_MT5_MASTER_PASSWORD, envelope recoverable true for all three (the wire false and the wizard true are different questions, pinned in separate columns).

## Verification

- `pytest tests/test_validate_key_permanent_400.py tests/test_sfox_validate.py tests/test_mt5_validate.py tests/test_mt5_validate_parity.py tests/test_mt5_rotate_secret_internal.py tests/test_validate_key_venue_transient.py tests/test_status_contract_exchange_internal.py tests/test_raw_5xx_census.py`: green after the census pin update (first run: 1 failed, 301 passed, the census). Direct-call tests in the four named files stayed green unedited.
- Wider sweep over the other `exchange.py` consumers (test_exchange*, error_contract*, mt5 rosters and concurrency, process_key, egress, redact): 548 passed and 321 passed in two batches.
- `vitest run` of the permanent-400 parity, venue-transient parity, `seam-venue-vocabulary.invariant`, `wizardErrors.invariant`, `wizardKeyRosters`, `dialog-envelope.invariant`: 207 passed. The vocabulary invariant passed unedited.
- CI strict mypy (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 143 source files`.
- `git status --porcelain -- supabase/migrations` printed nothing.

## PROOF-01 (verbatim)

Byte backups live in the session scratchpad; every restore was `cp` back followed by `cmp` (exit 0), never git checkout/restore/stash.

### Task 1, wire: sFOX 401 arm put back to a bare HTTPException 400 in the real file after `cp` to a backup

```
== NEUTERED
detail = 'Authentication failed. Check your API key and secret.'
E       AssertionError: sfox_http_401: the wire body must be EXACTLY ['code', 'detail', 'recoverable'], got ['detail']. A missing 'code' means the site still raises a plain HTTPException (or the app-global handler never matched).
detail = 'Authentication failed. Check your API key and secret.'
E       AssertionError: sfox_http_401: the wire body must be EXACTLY ['code', 'detail', 'recoverable'], got ['detail']. A missing 'code' means the site still raises a plain HTTPException (or the app-global handler never matched).
FAILED tests/test_validate_key_permanent_400.py::test_p1_sfox_rejected_token_answers_the_coded_400[401]
FAILED tests/test_validate_key_permanent_400.py::test_p1_sfox_rejected_token_answers_the_coded_400[403]
2 failed, 2 passed, 1 warning in 21.91s
cmp exit 0
== RESTORED
4 passed, 1 warning in 8.96s
```

### Task 1, TS parity: fixture case code changed to a value with no roster row

```
== NEUTERED
 FAIL  |jsdom| tests/lib/validate-key-permanent-400-parity.test.ts > [CONN-05] the wizard verdict is unchanged by the code on the permanent 400 arms > carries exactly the canonical case roster, no silent shrink
AssertionError: expected [ 'AUTH_FAILED' ] to include 'ZZ_NO_ROSTER_ROW'
 FAIL  |jsdom| tests/lib/validate-key-permanent-400-parity.test.ts > [CONN-05] the wizard verdict is unchanged by the code on the permanent 400 arms > P1 / sfox_http_401: the coded body renders the roster verdict
 FAIL  |jsdom| tests/lib/validate-key-permanent-400-parity.test.ts > [CONN-05] the wizard verdict is unchanged by the code on the permanent 400 arms > P1 / sfox_http_401: the HEAD-shape body (same detail, no code) renders the SAME verdict
 FAIL  |jsdom| tests/lib/validate-key-permanent-400-parity.test.ts > [CONN-05] the wizard verdict is unchanged by the code on the permanent 400 arms > P1 / sfox_http_401: the Retry affordance comes from the copy entry's actions, as today
 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
cmp exit 0
== RESTORED
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### Task 2, MT5: master-rejected arm reverted to a bare HTTPException 400

```
== NEUTERED (MT5 master arm)
E       AssertionError: mt5_master_password: the wire body must be EXACTLY ['code', 'detail', 'recoverable'], got ['detail']. A missing 'code' means the site still raises a plain HTTPException (or the app-global handler never matched).
FAILED tests/test_validate_key_permanent_400.py::test_p8_mt5_master_password_answers_the_coded_400
1 failed, 13 passed, 1 warning in 9.01s
cmp exit 0
== RESTORED
14 passed, 1 warning in 8.95s
```

### Task 2, sFOX: blank-token guard reverted

```
== NEUTERED (sFOX blank-token guard)
detail = 'Authentication failed. Check your API key and secret.'
E       AssertionError: sfox_blank_token: the wire body must be EXACTLY ['code', 'detail', 'recoverable'], got ['detail']. A missing 'code' means the site still raises a plain HTTPException (or the app-global handler never matched).
detail = 'Authentication failed. Check your API key and secret.'
E       AssertionError: sfox_blank_token: the wire body must be EXACTLY ['code', 'detail', 'recoverable'], got ['detail']. A missing 'code' means the site still raises a plain HTTPException (or the app-global handler never matched).
FAILED tests/test_validate_key_permanent_400.py::test_p2_sfox_blank_token_answers_the_coded_400_not_500[]
FAILED tests/test_validate_key_permanent_400.py::test_p2_sfox_blank_token_answers_the_coded_400_not_500[   ]
2 failed, 12 passed, 1 warning in 9.43s
cmp exit 0
```

### Task 2, census: one fixture case deleted (mt5_master_password)

```
== NEUTERED (fixture case deleted: mt5_master_password)
E       KeyError: 'mt5_master_password'
E       AssertionError: the committed fixture's case set drifted from the census typed in this file. only in fixture: []; only in census: ['mt5_master_password'].
FAILED tests/test_validate_key_permanent_400.py::test_p8_mt5_master_password_answers_the_coded_400
FAILED tests/test_validate_key_permanent_400.py::test_every_fixture_case_is_named_and_driven_here
2 failed, 12 passed, 1 warning in 9.08s
cmp exit 0
== RESTORED (both)
14 passed, 1 warning in 8.92s
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `test_raw_5xx_census.py` pins the count and status set of `VenueTransientHTTPException` constructions**
- **Found during:** Task 2 verification (the plan's own verification block lists this file as expected green)
- **Issue:** `test_httpexception_subclasses_and_their_sites_are_pinned` asserted 15 construction sites all at 424. Eight new 400 constructions made it 23 sites at {400, 424}.
- **Fix:** `EXPECTED_SUBCLASS_CONSTRUCTION_SITES` 15 -> 23 with a dated lineage note in the file's existing style, and the status-set pin widened from `{424}` to `{400, 424}`. The `>= 500` fence (blind spot (b)) is untouched and still green: all eight are 4xx.
- **Files modified:** analytics-service/tests/test_raw_5xx_census.py (not in the plan's `files_modified`)
- **Commit:** 30ea0092d

**2. [Process note] Wire tests for Task 2 were written after the router edit, not before**
- The plan says RED first. Task 1 followed it (the 401/403 tests failed with `got ['detail']` before the router edit). For Task 2 the seven arms were converted first and the tests added second; the RED evidence for them is the PROOF-01 neutering runs above, which show the named test failing on a missing `code` for the master arm and the blank-token arm.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. T-240-10 is mitigated by the control-character test asserting the token appears nowhere in the response text; T-240-12 holds (every converted site passes a non-empty constant detail and a literal 400).

## Self-Check: PASSED

- Created files exist: test_validate_key_permanent_400.py, validate_key_permanent_400_contract.json, validate-key-permanent-400-parity.test.ts.
- Commits 5bea89132 and 30ea0092d are ancestors of HEAD on wt/240-p03.
- STATE.md and ROADMAP.md untouched.
