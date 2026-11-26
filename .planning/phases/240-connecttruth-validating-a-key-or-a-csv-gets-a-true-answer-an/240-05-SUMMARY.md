---
phase: 240-connecttruth-validating-a-key-or-a-csv-gets-a-true-answer-an
plan: 05
subsystem: analytics-service validate-key error contract, TS wizard roster
tags: [conn-05, validate-key, venue-disabled, invalid-request, rotate-secret, ast-census]
requires: ["240-03"]
provides:
  - "validate_key sFOX and MT5 go-dark gates answer the flat 400 {detail, code: VENUE_DISABLED, recoverable: false}"
  - "validate_key create_exchange ValueError answers {detail, code: INVALID_REQUEST, recoverable: false}, with a fixed fallback detail for an empty message"
  - "rotate_key_secret refuses a dark MT5 venue with the same VENUE_DISABLED body, before the KEK load, decrypt and probe"
  - "TestNoRaw400OnValidateKeyArms: AST census, keyed by enclosing function name, that no bare HTTPException 400 remains on the validate-key path"
affects: [240-08]
tech-stack:
  added: []
  patterns: ["reasoned VENUE_WIRE_CODES_WITHOUT_VERDICT exemption instead of a verdict row that would render a false clause", "AST census keyed by function name with five synthetic self-tests"]
key-files:
  created: []
  modified:
    - analytics-service/routers/exchange.py
    - analytics-service/routers/internal.py
    - analytics-service/tests/test_validate_key_permanent_400.py
    - analytics-service/tests/test_mt5_rotate_secret_internal.py
    - analytics-service/tests/test_raw_5xx_census.py
    - analytics-service/tests/fixtures/validate_key_permanent_400_contract.json
    - src/lib/wizardErrors.ts
    - src/lib/seam-venue-vocabulary.invariant.test.ts
    - tests/lib/validate-key-permanent-400-parity.test.ts
decisions:
  - "VENUE_DISABLED and INVALID_REQUEST are exemptions, not verdict rows (UI-SPEC R1, R2); both still render UNKNOWN/500, replayed through the real classifier"
  - "Fixture cases and parity rows moved into Task 1's commit (the plan placed them in Task 2) so the fixture-census and the parity roster are never red between commits"
status: complete
estimate:
  tokens: 80000
  raw_tokens: 80000
  tasks: 2
  confidence: low
actuals:
  tokens: 9500
  tasks: 2
  commits: 2
plan_head_before: fe85150529
plan_head_after: e3f814f2495cd43bf61dbaacfb4d45e7fadbaeec
---

# Phase 240 Plan 05: Dark venues and an unsupported exchange answer coded 400s Summary

The last three uncoded validate-key 400 arms (sFOX and MT5 go-dark gates, `create_exchange` ValueError) now answer the flat `{detail, code, recoverable: false}` body with `VENUE_DISABLED` / `INVALID_REQUEST`; MT5 rotate-secret refuses a dark venue with the same body before any decrypt or probe; and an AST census pins that no bare 400 returns to the path.

`actuals.commits` is measured over the two task commits (`plan_head_before..plan_head_after`); the SUMMARY commit that follows is not counted. `actuals.tokens` is chars/4 over the non-`.planning` diff.

## What changed

| Site | Code | Detail | Notes |
|---|---|---|---|
| `validate_key` sFOX gate | VENUE_DISABLED | `SFOX_DISABLED_DETAIL` unchanged | before any client is built |
| `validate_key` MT5 gate | VENUE_DISABLED | `MT5_DISABLED_DETAIL` unchanged | before any client or probe |
| `validate_key` `except ValueError` | INVALID_REQUEST | `str(e) or _INVALID_REQUEST_FALLBACK_DETAIL` ("Unsupported exchange.") | fallback is unreachable today (real `create_exchange` raises "Unsupported exchange: {name}"), pinned by a test |
| `rotate_key_secret` | VENUE_DISABLED | `MT5_DISABLED_DETAIL` | after the 403, 429, 404 and 422 arms; before the KEK load, decrypt and `_validate_mt5_key` |

`get_key_permissions` and the TS rotate route are untouched (its raw sFOX 400 at `internal.py` stays; `test_s11_unsupported_exchange_name_stays_a_caller_400` was not edited).

TS side: two reasoned entries in `VENUE_WIRE_CODES_WITHOUT_VERDICT` (VENUE_DISABLED per ruling R1, INVALID_REQUEST per ruling R2), `EXPECTED_EMITTED_CODES` 48 -> 50 with dated comments, `DERIVED_FLOOR` 28 -> 30 with a history line (0.6 x 50 = 30.0, the rule moves the floor). The counts were read off the member-for-member assertion's own failure message (derived 50 against typed 48).

## Classifier replay (RESEARCH A5, which had not been replayed)

`classifyKeyValidationError` over each body, coded (own `seamCode`) and HEAD-shape (same detail, no code), 2026-11-24:

```
REPLAY VENUE_DISABLED "sFOX integration is not yet available." coded={"code":"UNKNOWN","status":500} headShape={"code":"UNKNOWN","status":500}
REPLAY VENUE_DISABLED "MT5 integration is not yet available." coded={"code":"UNKNOWN","status":500} headShape={"code":"UNKNOWN","status":500}
REPLAY INVALID_REQUEST "Unsupported exchange: nasdaq" coded={"code":"UNKNOWN","status":500} headShape={"code":"UNKNOWN","status":500}
REPLAY INVALID_REQUEST "Unsupported exchange." coded={"code":"UNKNOWN","status":500} headShape={"code":"UNKNOWN","status":500}
```

All UNKNOWN, as the rulings assumed, so no stop-and-report. The envelope's `recoverable` for UNKNOWN replays as `true` (the wizard offers Retry); a first guess of `false` in the parity roster was wrong and was corrected from the replay, not the other way round. The parity rows pin verdict UNKNOWN for both codes, equal to the HEAD-shape verdict.

## RED first (vocabulary invariant, after the Python edit and before the TS edit)

```
 ❯ |jsdom| src/lib/seam-venue-vocabulary.invariant.test.ts (27 tests | 2 failed) 3518ms
     × the derived population matches the hand-typed roster, member for member 159ms
     × EVERY derived code has an explicit disposition — a verdict row or a reasoned exemption 3ms
AssertionError: expected [ 'ADAPTER_INIT_FAILED', …(50) ] to deeply equal [ 'ADAPTER_INIT_FAILED', …(48) ]
+   "INVALID_REQUEST",
+   "VENUE_DISABLED",
AssertionError: These error_codes are EMITTED by analytics-service and TypeScript has no explicit answer for them ... expected [ 'INVALID_REQUEST', 'VENUE_DISABLED' ] to deeply equal []
 Tests  2 failed | 25 passed (27)
```

## Verification

- `pytest` over `test_validate_key_permanent_400`, `test_mt5_rotate_secret_internal`, `test_status_contract_exchange_internal`, `test_validate_key_venue_transient`, `test_raw_5xx_census`, `test_sfox_validate`, `test_mt5_validate`, `test_mt5_validate_parity`, `test_limiter_route_coverage`, `test_sfox_internal_probe`, `test_mt5_internal_probe`: `337 passed, 1 skipped`.
- `vitest run` of the permanent-400 parity, venue-transient parity, `seam-venue-vocabulary.invariant`, `wizardErrors.invariant`, `wizardKeyRosters`, `dialog-envelope.invariant`, and `keys/[id]/rotate-secret/route.test.ts`: `7 files, 278 passed`.
- CI strict mypy (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 143 source files`.
- `git status --porcelain -- supabase/migrations` printed nothing.
- Acceptance greps: `code="VENUE_DISABLED"` 2, `code="INVALID_REQUEST"` 1, `mt5_enabled_server` in `internal.py` 3, `raise HTTPException(status_code=400` in `exchange.py` 1 (only `fetch_trades`), `class TestNoRaw400OnValidateKeyArms` 1, `DERIVED_FLOOR = 30` 1, `DERIVED_FLOOR = 28` 0, `setenv("MT5_ENABLED", "true")` in the rotate test 1.

## PROOF-01 (verbatim)

Every neuter was on a real file after `cp` to a byte backup in the session scratchpad; every restore was `cp` back followed by `cmp` (exit 0). Never git checkout, restore or stash.

### Roster: `VENUE_DISABLED` line removed from `EXPECTED_EMITTED_CODES`

```
== NEUTERED (roster line VENUE_DISABLED removed)
     × the derived population matches the hand-typed roster, member for member 17ms
AssertionError: expected [ 'ADAPTER_INIT_FAILED', …(50) ] to deeply equal [ 'ADAPTER_INIT_FAILED', …(49) ]
+   "VENUE_DISABLED",
      Tests  1 failed | 26 passed (27)
cmp exit 0
== RESTORED
 Test Files  1 passed (1)
      Tests  27 passed (27)
```

### Exemption: `INVALID_REQUEST` entry removed from `wizardErrors.ts`

```
== NEUTERED (INVALID_REQUEST exemption removed)
     × EVERY derived code has an explicit disposition — a verdict row or a reasoned exemption 7ms
AssertionError: These error_codes are EMITTED by analytics-service and TypeScript has no explicit answer for them, so they fall through the substring cascade to whatever an English sentence happens to earn — which is how MISSING_SCOPE rendered "we could not classify this failure" for a key scope the exchange named precisely. Add a row to VENUE_WIRE_CODE_TO_VERDICT, or an entry with a MEASURED reason to VENUE_WIRE_CODES_WITHOUT_VERDICT. Do not delete this test.: expected [ 'INVALID_REQUEST' ] to deeply equal []
+ [
+   "INVALID_REQUEST",
      Tests  1 failed | 26 passed (27)
cmp exit 0
== RESTORED
 Test Files  1 passed (1)
      Tests  27 passed (27)
```

### Empty edge: fallback dropped (`detail=str(e)` alone) in `exchange.py`

```
== NEUTERED (fallback dropped: detail=str(e) alone)
E       AssertionError: unsupported_exchange_empty_message: status must stay 400, got 500 with text 'Internal Server Error'. A bodyless 500 here is a flat-body constructor guard (an empty detail) escaping as an unhandled error.
E       assert 500 == 400
E        +  where 500 = <Response [500 Internal Server Error]>.status_code
FAILED tests/test_validate_key_permanent_400.py::test_p11_create_exchange_empty_value_error_answers_the_coded_400_not_500
1 failed, 18 passed, 1 warning in 8.95s
cmp exit 0
== RESTORED
19 passed, 1 warning in 10.58s
```

(A first run of this neuter, before the helper asserted the status ahead of `response.json()`, failed with a `JSONDecodeError` on the bodyless 500. The helper now names the 500 directly; the output above is the run against the final helper.)

### Census: MT5 go-dark gate reverted to a bare HTTPException 400

```
== NEUTERED (MT5 go-dark gate back to a bare HTTPException 400)
E       AssertionError: a bare HTTPException(400) is back on the validate-key path: [('validate_key', 400)]. Raise VenueTransientHTTPException(status_code=400, code=..., detail=..., recoverable=False) so every 400 body carries a machine code.
E       assert {('validate_key', 400)} == set()
cmp exit 0
== RESTORED
8 passed, 19 deselected in 9.11s
```

### Census reach: one `_connect_and_probe` arm (MT5_WRONG_SERVER) reverted

```
== NEUTERED (one _connect_and_probe arm: MT5_WRONG_SERVER back to a bare 400)
E       AssertionError: a bare HTTPException(400) is back on the validate-key path: [('_connect_and_probe', 400)]. Raise VenueTransientHTTPException(status_code=400, code=..., detail=..., recoverable=False) so every 400 body carries a machine code.
E       assert {('_connect_and_probe', 400)} == set()
cmp exit 0
== RESTORED
8 passed, 19 deselected in 8.56s
```

### Rotate gate: gate deleted from `internal.py`

```
== NEUTERED (rotate-secret MT5 gate deleted)
FAILED tests/test_mt5_rotate_secret_internal.py::test_rotate_secret_with_mt5_off_answers_the_coded_400_before_any_decrypt_or_probe[unset]
FAILED tests/test_mt5_rotate_secret_internal.py::test_rotate_secret_with_mt5_off_answers_the_coded_400_before_any_decrypt_or_probe[empty]
FAILED tests/test_mt5_rotate_secret_internal.py::test_rotate_secret_with_mt5_off_answers_the_coded_400_before_any_decrypt_or_probe[false]
FAILED tests/test_mt5_rotate_secret_internal.py::test_rotate_secret_with_mt5_off_answers_the_coded_400_before_any_decrypt_or_probe[one]
4 failed, 19 passed in 10.38s
cmp exit 0
== RESTORED
23 passed in 10.64s
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `test_raw_5xx_census.py` pins the count of `VenueTransientHTTPException` constructions**
- **Found during:** Task 1 verification (the plan 03 deviation note predicted it)
- **Fix:** `EXPECTED_SUBCLASS_CONSTRUCTION_SITES` 23 -> 26 in Task 1 (three new constructions in `exchange.py`) and 26 -> 27 in Task 2 (the rotate gate), each with a dated lineage note in the file's existing style. The status set stays {400, 424}. File is not in the plan's `files_modified`.
- **Commits:** 2f7ec1dde, e3f814f24

**2. [Rule 3 - Blocking] Fixture cases and parity rows landed in Task 1, not Task 2**
- **Issue:** the wire tests Task 1 adds drive `_assert_flat_permanent_body`, which compares the real body with the committed fixture, and the fixture-census and the TS parity roster are one-to-one with it. Splitting them across commits would leave one red between commits, the exact thing the plan forbids for the invariant.
- **Fix:** the four fixture cases (`sfox_disabled`, `mt5_disabled`, `unsupported_exchange`, `unsupported_exchange_empty_message`), `EXPECTED_FIXTURE_TRIGGERS`, and the two parity roster rows (`TOTAL_CASES` 8 -> 12, `DISTINCT_WIRE_CODES` 3 -> 5) are in Task 1's commit. Task 2 holds the rotate gate, its tests and the census.

**3. [Rule 1 - Bug, test harness] Helper asserted `response.json()` before the status**
- A bodyless 500 surfaced as a `JSONDecodeError`. `_assert_flat_permanent_body` now asserts the status first and names the cause. Behaviour for every existing case is unchanged.

**4. [Process note] Wire tests were written after the Python edit; RED evidence is the vocabulary-invariant failure above and the PROOF-01 neuters.** The vocabulary invariant was run RED after the Python edit and before the TS edit, as the plan asked.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. T-240-16 mitigated (the dark-venue rotate test asserts `get_kek`, `decrypt_credentials`, `_validate_mt5_key` and `encrypt_credentials` were never called, over four disabled values, and that the new secret is absent from the response). T-240-17: INVALID_REQUEST's detail is `create_exchange`'s only message or a fixed constant; the S-11 internal path is untouched. T-240-18: roster 50 / floor 30 / disposition move with the raise sites in one commit. T-240-19: the fallback is pinned by the bare-ValueError test.

## Self-Check: PASSED

- Modified files exist; commits 2f7ec1dde and e3f814f24 are ancestors of HEAD on wt/240-p05.
- STATE.md and ROADMAP.md untouched.
