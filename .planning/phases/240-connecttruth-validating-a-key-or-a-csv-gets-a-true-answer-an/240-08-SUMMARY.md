---
phase: 240-connecttruth-validating-a-key-or-a-csv-gets-a-true-answer-an
plan: 08
subsystem: analytics-service /process-key permanence routing, STATUS_CONTRACT
tags: [conn-05, permanence, process-key, status-contract, error-contract]
requires: ["240-03", "240-04", "240-05"]
provides:
  - "both adapter-fed /process-key validation arms honour a stated ValidationResult.permanent True (sync gate: 403 recoverable false; validate-only: 200 recoverable false); stated False and None keep the HEAD verdict"
  - "test_process_key_permanence_plumbing.py, the fifteen-row decision table driven through the real route"
  - "STATUS_CONTRACT.md with zero prose path:line coordinates outside the section 7 S-table, a census note, and the flat 400 record"
affects: []
tech-stack:
  added: []
  patterns: ["True-only consumption of a tri-state provenance field, recorded at both ends (route comment and adapter.py comment)"]
key-files:
  created:
    - analytics-service/tests/test_process_key_permanence_plumbing.py
  modified:
    - analytics-service/routers/process_key.py
    - analytics-service/services/ingestion/adapter.py
    - analytics-service/docs/STATUS_CONTRACT.md
    - analytics-service/services/error_contract.py
    - analytics-service/routers/exchange.py
    - analytics-service/tests/test_validate_key_venue_transient.py
decisions:
  - "The route honours a stated permanent True ONLY (CONTEXT CONN-05 light touch); a stated False keeps every HEAD verdict, so an adapter's say-so can never turn a credential or scope 403 into a retryable 424"
  - "PERMANENT_VALIDATION_ERROR_CODES and _ROUTE_TERMINAL_ERROR_CODES unchanged: the fix reads the provenance channel, no code list grew"
  - "STATUS_CONTRACT claims that were no longer true at HEAD (analytics_runner HTTPException, permissions route err.detail read, handler location) got dated CORRECTED notes or were rewritten in the file's voice, not silently edited"
requirements-completed: [CONN-05]
metrics:
  duration: "about 40 minutes"
  completed: 2026-11-24
status: complete
estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 2
  confidence: low
actuals:
  tokens: 5650
  tasks: 2
  commits: 2
plan_head_before: 3e0bd6dd1b0cd1aefa5451d48659dfcd944134f0
plan_head_after: a109a96433669db88f4214348bdd5e36590fed31
---

# Phase 240 Plan 08: Stated permanence on the sync arms, and a STATUS_CONTRACT that cannot rot silently Summary

`/process-key`'s two adapter-fed validation arms now honour an adapter's stated `permanent=True` (MT5_WRONG_SERVER and MT5_MASTER_PASSWORD answer 403 `recoverable:false` at the synchronous gate and `recoverable:false` on the validate-only 200), a stated False moves nothing, and STATUS_CONTRACT.md cites every non-census coordinate by symbol.

`actuals.commits` is measured over the two task commits (`plan_head_before..plan_head_after`); the SUMMARY commit that follows is not counted. `actuals.tokens` is chars/4 over the non-`.planning` diff (22602 chars).

## What changed

Task 1 (`ff7703797`, tracer, TDD):
- `routers/process_key.py`: the 424 pre-gate gained one conjunct, `val.permanent is not True`; the 403 `_envelope_error` return and `_run_validate_only`'s invalid return pass `recoverable=False if val.permanent is True else None`. `grep -a -c "val.permanent"` on the file: 3 (the pre-gate conjunct, the 403 call, the validate-only call; HEAD 0). The pre-gate comment states the rule and its source: long_fetch is the first consumer and honours both directions, this arm is the second and honours True only by decision, latent for MT5 today (onboard and resync go to the worker).
- `services/ingestion/adapter.py`: comment only. The paragraph "All three states are LIVE at the one consumer" now reads "first consumer" and a new paragraph names the second consumer and the True-only decision.
- `tests/test_process_key_permanence_plumbing.py`: thirteen synchronous-gate rows through `_teaser_post` plus two validate-only rows, all literal. `_teaser_post` and the `client` fixture are imported by name from `tests.test_process_key_scope_rejection_statuses` (underscore helper and fixture only, so no `test_` function is collected twice; no collection side effect observed).

Task 2 (`a109a9643`):
- STATUS_CONTRACT.md: 26 prose coordinates replaced (see the re-derivation list below), census sentence above the S-table, section 2.1 paragraph on the flat permanent 400 arms and the rotate-secret go-dark gate.
- `services/error_contract.py`: module docstring says five classes and lists the CALLER, THROTTLED 429 row; `_validate` docstring says five-class; `VenueTransientHTTPException` docstring records it is the one flat-body builder and also carries permanent validate-key 400s.
- `routers/exchange.py`: comment above the `service_error` import says five classes.
- `tests/test_validate_key_venue_transient.py`: docstring sentence "no site uses it any more" rewritten.

## Coordinate re-derivation list (STATUS_CONTRACT, derived by symbol at base 3e0bd6dd1)

| Old coordinate | Replaced by | Note |
|---|---|---|
| `services/exchange.py:978-1021` | `validate_key_permissions`'s `result["error_code"] = ...` assignments | |
| `routers/simulator.py:466` and S-18 `:460` | the simulation-failure arm, code text `"SIMULATION_FAILED"` | now raised through `service_error` |
| `services/error_contract.py:345`, `main.py:574` | class `VenueTransientHTTPException`, `venue_transient_exception_handler` in `services/app_error_handlers.py` | handlers moved out of `main.py` |
| `routers/exchange.py:163,178,371,387,409,598,447` and `routers/portfolio.py:2354,2201` | `_validate_sfox_key`, `_validate_mt5_key_probe`, `_connect_and_probe`, `validate_key`, `verify_strategy` (the raise coded `validation["error_code"]`) | enumeration already marked stale in the file; kept as lineage |
| `routers/internal.py:246` | the `if not _consume_rate_limit(key_id):` arm | |
| `src/app/api/keys/[id]/permissions/route.ts:147,275,254-268` | the route's `!res.ok` arm and the catch testing `rawMessage` | claim rewritten past tense: the route reads through the discriminator since 140.3-01 |
| `routers/internal.py:227`, `main.py:526` | `retry_after=int(_RATE_LIMIT_WINDOW_S)` arms, `rate_limit_exceeded_handler` | |
| `routers/exchange.py:96,114,123,130,143,203,204,385,393,412` | the `HTTPException(400, ...)` arms of the four named functions | |
| `routers/exchange.py:454`, `routers/portfolio.py:2277` | the raises coded `"ADAPTER_INIT_FAILED"` in `validate_key` and `verify_strategy` | |
| `routers/exchange.py:660,670,685,689,698,760`, `routers/csv.py:95`, `routers/portfolio.py:2242,2446`, `routers/cron.py:613,631`, `routers/debug_key_flow.py:56,100` | the six `fetch_trades` arms by their detail strings; `_read_capped`/`csv_validate`; `portfolio_bridge`/`verify_strategy`; `cron_sync`; `_verify_internal_token`/`_read_test_creds` | the cron arms at the old numbers no longer exist; named by what HEAD has |
| `services/analytics_runner.py:1725`, `services/job_worker.py:1947` | hygiene flag kept as lineage with a dated CORRECTED note | `grep -n HTTPException services/analytics_runner.py` finds nothing at HEAD: the raise is gone |
| `main.py:424,533,608` (section 7 handler table), "registrations in `main.py`" | the three handler names in `services/app_error_handlers.py`, registered by `install_app_exception_handlers` | prose claim corrected too |
| `services/error_contract.py:399` | `VenueTransientHTTPException.__init__` | |
| `src/lib/analytics-client.ts:179` | the validate-key error read in `analytics-client.ts` | |

Gate: `grep -anE '[A-Za-z_/.-]+\.(py|ts|tsx):[0-9]+' analytics-service/docs/STATUS_CONTRACT.md | grep -av '^[0-9]*:| S-' | wc -l` prints 0 (HEAD 26).

## Verification

- Plan verify 1: `tests/test_process_key_permanence_plumbing.py tests/test_process_key_scope_rejection_statuses.py tests/test_envelope_recoverable.py`: 51 passed (including `test_permanent_set_is_exactly_the_five_pinned_codes`, unedited).
- Plan verify 2: `tests/test_process_key.py tests/test_process_key_anon_ip_tier.py tests/test_process_key_csv_tier.py`: 148 passed.
- Task 2 verify: `tests/test_validate_key_venue_transient.py tests/test_error_contract_429.py tests/test_error_contract_r1_permanent_500.py tests/test_error_contract_scalar_detail.py tests/test_validate_key_permanent_400.py`: 120 passed.
- Wider sweep after both tasks (`test_status_contract_match_sim_portfolio`, `test_status_contract_exchange_internal`, `test_validation_error_contract`, `test_sfox_validate`, `test_mt5_validate`, the plumbing, scope-rejection, envelope-recoverable, `test_process_key`, `test_raw_5xx_census`): 386 passed, 1 skipped. The one skip is pre-existing and not in a file this plan touched; it was not investigated.
- CI strict mypy (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 143 source files`.
- Acceptance greps: `grep -a -c "val.permanent" routers/process_key.py` prints 3 (EXPECT >= 3); `grep -a -c "Phase 240" services/ingestion/adapter.py` prints 1; `VENUE_DISABLED` count in STATUS_CONTRACT 2; `historical census` count 1; `four[- ]class` count 0 in `error_contract.py` and 0 in `exchange.py`; the "even though no site uses it any more" count 0; `THROTTLED` in `error_contract.py` 1.
- `git status --porcelain -- supabase/migrations` printed nothing.
- Post-commit deletion check on both task commits printed nothing.

## PROOF-01 (verbatim)

Method: `cp routers/process_key.py` to a scratchpad backup, neuter the real file with a script that asserts its target text occurs exactly once, run the plumbing file RED, `cp` the backup back, `cmp` (exit 0), run GREEN. Never git checkout/restore/stash. Neuter A drops the stated-True conjunct from the pre-gate; B adds a disjunct sending a stated False to 424; C stops passing `recoverable=False` at the 403 call; D stops passing it at the validate-only call.

```
=================== PROOF-01 neuter A
neutered: 3 changed diff lines
--- RED run
FAILED tests/test_process_key_permanence_plumbing.py::test_synchronous_gate_decision_table[true-mt5-wrong-server]
FAILED tests/test_process_key_permanence_plumbing.py::test_synchronous_gate_decision_table[true-mt5-master-password]
2 failed, 13 passed in 12.86s
cmp exit: 0
--- GREEN run
15 passed in 12.79s
=================== PROOF-01 neuter B
neutered: 2 changed diff lines
--- RED run
___________ test_synchronous_gate_decision_table[false-auth-failed] ____________
case_id = 'false-auth-failed', valid = False, read_only = None
E       AssertionError: {"ok":false,"code":"AUTH_FAILED","human_message":"Key rejected.","debug_context":{"verification_id":"ver-permplumb-false-auth-failed"},"correlation_id":"11111111-1111-4111-8111-111111111111","recoverable":true}
2026-11-24 22:48:22 [warning  ] process_key.write_capable_key_rejected correlation_id=11111111-1111-4111-8111-111111111111 flow_type=teaser read_only=None reject_code=AUTH_FAILED source=okx verification_id=ver-permplumb-false-auth-failed
2026-11-24 22:48:22 [warning  ] process_key.venue_transient_validation correlation_id=11111111-1111-4111-8111-111111111111 flow_type=teaser read_only=None reject_code=AUTH_FAILED source=okx verification_id=ver-permplumb-false-auth-failed
FAILED tests/test_process_key_permanence_plumbing.py::test_synchronous_gate_decision_table[false-auth-failed]
FAILED tests/test_process_key_permanence_plumbing.py::test_synchronous_gate_decision_table[false-permission-denied]
FAILED tests/test_process_key_permanence_plumbing.py::test_synchronous_gate_decision_table[false-trade-scope]
FAILED tests/test_process_key_permanence_plumbing.py::test_synchronous_gate_decision_table[false-withdraw-scope]
FAILED tests/test_process_key_permanence_plumbing.py::test_synchronous_gate_decision_table[false-missing-scope]
FAILED tests/test_process_key_permanence_plumbing.py::test_synchronous_gate_decision_table[false-no-code-read-only-false]
6 failed, 9 passed in 12.62s
cmp exit: 0
--- GREEN run
15 passed in 10.70s
=================== PROOF-01 neuter C
neutered: 1 changed diff lines
--- RED run
FAILED tests/test_process_key_permanence_plumbing.py::test_synchronous_gate_decision_table[true-mt5-wrong-server]
FAILED tests/test_process_key_permanence_plumbing.py::test_synchronous_gate_decision_table[true-mt5-master-password]
2 failed, 13 passed in 11.17s
cmp exit: 0
--- GREEN run
15 passed in 10.26s
=================== PROOF-01 neuter D
neutered: 1 changed diff lines
--- RED run
2026-11-24 22:49:12 [info     ] process_key.validate_only_failed correlation_id=11111111-1111-4111-8111-111111111111 duration_ms=0 error_code=MT5_WRONG_SERVER flow_type=csv source=csv
FAILED tests/test_process_key_permanence_plumbing.py::test_validate_only_decision_table[true-mt5-wrong-server]
1 failed, 14 passed in 9.87s
cmp exit: 0
--- GREEN run
15 passed in 9.62s
```

Initial RED before the implementation (HEAD route, new test file): `3 failed, 12 passed` with the three True rows failing (`true-mt5-wrong-server`, `true-mt5-master-password`, validate-only `true-mt5-wrong-server`); every False and None row already passed at HEAD, as the plan predicted. The STATUS_CONTRACT coordinate gate has no neuter pair of its own: it is a measured count (26 at HEAD, 0 after) and is not a test file.

## Deviations from Plan

None - plan executed exactly as written.

Notes, not deviations: (1) the plan's neuter B wording ("add a disjunct that sends a stated False to 424") was realised as `val.permanent is False or (...)`; the (False, MT5_SERVER_UNKNOWN) row stays 424 under it by design, so it is not among the six red rows. (2) Several STATUS_CONTRACT claims turned out false at HEAD, and the plan's "correct the claim and add a dated CORRECTED note" instruction was applied where the sentence was itself wrong (the analytics_runner hygiene flag; the handler location). Other stale-in-substance sentences (the seven-raise enumeration, the permissions route `err.detail` read) were already marked stale or CLOSED by the file and only lost their coordinates.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema change; `git status --porcelain -- supabase/migrations` is empty.

## Issues Encountered

None.

## Self-Check: PASSED

Created file `analytics-service/tests/test_process_key_permanence_plumbing.py` present; commits `ff7703797` and `a109a9643` are ancestors of HEAD on `wt/240-p08`; all verify commands above green; mypy strict green; coordinate gate 0.
