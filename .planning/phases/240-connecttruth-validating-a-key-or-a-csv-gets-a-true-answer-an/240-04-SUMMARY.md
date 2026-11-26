---
phase: 240-connecttruth-validating-a-key-or-a-csv-gets-a-true-answer-an
plan: 04
subsystem: api
tags: [slowapi, rate-limiting, hmac-claim, fastapi, csv]

requires:
  - phase: 240-02
    provides: classify_tenant_claim, the three-limit /process-key stack and the exempt_when predicate shape
provides:
  - the csv kind in ClaimClass and classify_tenant_claim (csv: plus a canonical lowercase uuid, strict fullmatch)
  - csv_bucket_key, the one spelling of process_key:csv:<uuid>
  - _PROCESS_KEY_CSV_LIMIT = 60/minute, sizing csv keys in _process_key_limit_for
  - _process_key_is_csv_scoped as the platform ceiling's exempt_when (strict, never raises, fault answers not-exempt)
affects: [240-06 (mints the csv:<uuid> claim and the Python parity), 240-07 (reads _PROCESS_KEY_CSV_LIMIT for the edge/upstream agreement test)]

plan_head_before: fe851505297893291ef92b002abc276b8c675536
plan_head_after: f15c238fd6543f02f5f2fa0b7de5bee5283b353e
actuals:
  tokens: 5690
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "csv scope rides the HMAC-signed claim payload; the one classifier turns it into a kind, and every consumer (both key functions, the provider by key prefix, the ceiling exemption) reads that kind"
    - "an exemption predicate answers not-exempt on any fault, so a fault refuses rather than skips a limit"

key-files:
  created:
    - analytics-service/tests/test_process_key_csv_tier.py
  modified:
    - analytics-service/services/rate_limit.py
    - analytics-service/routers/process_key.py
    - analytics-service/tests/test_tenant_claim_parsing.py
    - analytics-service/tests/test_process_key.py

key-decisions:
  - "A malformed csv: payload (non-uuid, uppercase, extra characters, newline, non-ASCII digits, no hyphens) is a plain tenant: tenant tier, no ceiling exemption"
  - "The shared 100/hour tenant tier is not retuned; ROADMAP SC-4 is met by the csv-scoped tier per the founder ruling"
  - "The exemption rides the existing ceiling decorator (no fourth limit), and the ceiling stays last in evaluation order"
  - "Both key functions map csv to csv_bucket_key (tenant_or_platform_key included, per the plan); no route other than /process-key can currently receive a csv claim from TS"

requirements-completed: [RLIM-02]

coverage:
  - id: D1
    description: "A csv-scoped user gets 20 calls and then up to 60 in one window with no 429; call 61 is refused"
    requirement: RLIM-02
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_process_key_csv_tier.py#test_the_edge_limits_twenty_csv_validations_are_never_refused_upstream"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_process_key_csv_tier.py#test_the_csv_tier_admits_sixty_calls_in_a_window_and_refuses_the_sixty_first"
        status: pass
    human_judgment: false
  - id: D2
    description: "The csv bucket is separate from the same user's plain tenant bucket and from other users' csv buckets; the provider sizes csv keys at 60/minute and leaves the tenant tier at 100/hour"
    requirement: RLIM-02
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_process_key_csv_tier.py#test_the_csv_bucket_is_separate_from_the_users_tenant_bucket_and_from_other_users"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_process_key.py#test_process_key_limit_sizing_literals"
        status: pass
    human_judgment: false
  - id: D3
    description: "A strictly csv-scoped call is admitted after tenant traffic saturated the platform ceiling"
    requirement: RLIM-02
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_process_key_csv_tier.py#test_a_csv_scoped_call_is_admitted_after_tenant_traffic_saturated_the_ceiling"
        status: pass
    human_judgment: false
  - id: D4
    description: "A malformed csv payload is refused at the ceiling, never exempt; the classifier grammar is strict"
    requirement: RLIM-02
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_process_key_csv_tier.py#test_a_malformed_csv_payload_is_not_exempt_from_the_ceiling"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_tenant_claim_parsing.py#TestCsvScopeGrammar"
        status: pass
    human_judgment: false
  - id: D5
    description: "The exemption predicate never raises on hostile input and answers not-exempt on a fault; csv traffic never consumes the anonymous aggregate"
    requirement: RLIM-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_process_key_csv_tier.py#test_the_csv_predicate_refuses_rather_than_skips_on_a_fault"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_tenant_claim_parsing.py#TestCsvCeilingPredicateIsTotal"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_process_key_csv_tier.py#test_csv_traffic_never_consumes_an_anonymous_aggregate_slot"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-11-24
status: complete
---

# Phase 240 Plan 04: CSV-scoped upstream tier and ceiling exemption on /process-key Summary

**A signed `csv:<uuid>` claim now buckets to its own 60/minute per-user window (`process_key:csv:<uuid>`), separate from the user's 100/hour onboard and resync window, and is exempt from the 500/hour platform ceiling, strictly: a malformed `csv:` payload and any predicate fault stay under the ceiling.**

## Performance

- **Duration:** about 40 min
- **Completed:** 2026-11-24
- **Tasks:** 2 (one tracer, one auto, both TDD)
- **Files modified:** 5 (one new test file)

## Accomplishments

- `services/rate_limit.py`: `CSV_PAYLOAD_PREFIX`, `_CSV_PAYLOAD_RE` (`csv:` plus 8-4-4-4-12 lowercase hex, `re.ASCII`, `fullmatch`), `csv_bucket_key(scope, user_id)` and the `csv` kind in `ClaimClass` / `classify_tenant_claim`. A payload that starts with `csv:` but does not fullmatch falls through to the plain tenant arm. Both key functions map csv to `csv_bucket_key`; both docstring bucket tables carry the csv row; the module token-cost table has a row for CSV validate through `/process-key` (one token of the 60/minute csv tier, no ceiling token). The `routers/csv.py` L-4 row is untouched.
- `routers/process_key.py`: `_PROCESS_KEY_CSV_LIMIT = "60/minute"` with the derivation docblock (three times the edge's per-window cap; a reading of the documented algorithm, "not airtight"); `_process_key_limit_for` sizes `process_key:csv:` keys at it; `_process_key_is_csv_scoped` reads the classifier and is the ceiling decorator's `exempt_when`. The stack is still three `@limiter.limit(` decorators in the same order; the ceiling stays last.
- The ceiling's docblock records the exemption, why only an exemption keeps "a CSV user inside the edge limit is never refused upstream" true (20 per 60 s is 1,200/hour for one user against a 500/hour ceiling), and what still bounds CSV traffic (per-user edge limit, authentication, body cap, row cap, the 60/minute tier).
- `_PROCESS_KEY_TENANT_LIMIT` stays `"100/hour"`: SC-4 is met by the csv tier, not by retuning the shared tier.

## Task Commits

1. **Task 1 (tracer): the csv kind, its key, its size over the real limiter** - `7d45020ae`
2. **Task 2: strict ceiling exemption; pins and docblocks move together** - `f15c238fd`

## Verification

- Plan verification set (ten test files): `331 passed, 1 warning`.
- CI strict mypy command: `Success: no issues found in 143 source files`.
- `git status --porcelain -- supabase/migrations` printed nothing.
- Acceptance greps: `_PROCESS_KEY_CSV_LIMIT = "60/minute"` 1, `_PROCESS_KEY_TENANT_LIMIT = "100/hour"` 1, `def csv_bucket_key` 1, `exempt_when=_process_key_is_csv_scoped` 1, `@limiter.limit(` 3.
- STATE.md and ROADMAP.md untouched (the orchestrator owns them).

## CHANGELOG note (recorded, not written here)

The platform ceiling no longer backstops CSV traffic in aggregate. That is the founder-ruled cost of "a CSV user inside the edge limit is never refused upstream" (CONTEXT discretion resolution). CSV traffic is still bounded by the per-user edge limit, authentication, the body and row caps and the per-user 60/minute tier. TODOS entry "csv-validate: 12x over the shared `/process-key` tenant tier + stale docblock citation" closes jointly with plans 06 and 07 and is deleted at ship, not here.

## PROOF-01 (five neuters, each on a byte backup restored with cp)

Every block is the verbatim output. Pytest was run with `-q -p no:cacheprovider` from `analytics-service/`, with output filtered to FAILED lines and the summary line.

### 1. Size (`_PROCESS_KEY_CSV_LIMIT` set to 10/minute in a byte-backed `routers/process_key.py`)

The 20-call test, the 60-call test and the provider-sizing test all fail by name.

```
=== PROOF-01 size: neuter (_PROCESS_KEY_CSV_LIMIT = 10/minute) ===
139:_PROCESS_KEY_CSV_LIMIT = "10/minute"
FAILED tests/test_process_key_csv_tier.py::test_the_edge_limits_twenty_csv_validations_are_never_refused_upstream
FAILED tests/test_process_key_csv_tier.py::test_the_csv_tier_admits_sixty_calls_in_a_window_and_refuses_the_sixty_first
FAILED tests/test_process_key_csv_tier.py::test_the_provider_sizes_a_csv_key_at_sixty_per_minute
3 failed, 1 passed in 22.65s
cmp exit=0
=== GREEN ===
4 passed in 20.97s
```

### 2. Scope (a well-formed csv payload classified as tenant in a byte-backed `services/rate_limit.py`)

The 61st-refused assertion fails (the payload falls to the 100/hour tenant tier, so call 61 is admitted) and the csv classifier rows fail by name.

```
=== PROOF-01 scope: neuter (a well-formed csv payload is classified as tenant) ===
422:            return ClaimClass("tenant", payload)
425:        return ClaimClass("tenant", payload)
FAILED tests/test_process_key_csv_tier.py::test_the_csv_tier_admits_sixty_calls_in_a_window_and_refuses_the_sixty_first
FAILED tests/test_process_key_csv_tier.py::test_the_csv_bucket_is_separate_from_the_users_tenant_bucket_and_from_other_users
FAILED tests/test_tenant_claim_parsing.py::TestCsvScopeGrammar::test_a_well_formed_csv_payload_gets_its_own_bucket_on_both_key_functions
FAILED tests/test_tenant_claim_parsing.py::TestCsvScopeGrammar::test_a_csv_bucket_can_never_be_a_tenant_or_anonymous_bucket
4 failed, 43 passed in 15.99s
cmp exit=0
=== GREEN ===
47 passed in 19.91s
```

### 3. Exemption (the ceiling decorator's `exempt_when` dropped)

The `1` after the header is a `grep -a -c "exempt_when=_process_key_is_csv_scoped"` count taken after the neuter: at the time of this run a code comment still carried that spelling (reworded afterwards so the acceptance count of the live decorator argument is 1). The neuter removed the decorator argument only, and the failing test proves it.

```
=== PROOF-01 exemption: neuter (the ceiling decorator's exempt_when dropped) ===
1
FAILED tests/test_process_key_csv_tier.py::test_a_csv_scoped_call_is_admitted_after_tenant_traffic_saturated_the_ceiling
1 failed, 63 passed in 9.33s
cmp exit=0
=== GREEN ===
64 passed in 9.11s
```

### 4. Strictness (predicate tests `startswith("csv:")` on the raw verified payload)

```
=== PROOF-01 strictness: neuter (predicate tests startswith('csv:') on the raw payload) ===
227:        return _p is not None and _p.startswith("csv:")
FAILED tests/test_process_key_csv_tier.py::test_a_malformed_csv_payload_is_not_exempt_from_the_ceiling[non-uuid]
FAILED tests/test_process_key_csv_tier.py::test_a_malformed_csv_payload_is_not_exempt_from_the_ceiling[uppercase]
FAILED tests/test_process_key_csv_tier.py::test_a_malformed_csv_payload_is_not_exempt_from_the_ceiling[trailing-char]
FAILED tests/test_process_key_csv_tier.py::test_a_malformed_csv_payload_is_not_exempt_from_the_ceiling[empty]
FAILED tests/test_process_key_csv_tier.py::test_the_csv_predicate_is_true_only_for_a_strict_csv_claim
5 failed, 59 passed in 9.07s
cmp exit=0
=== GREEN ===
64 passed in 10.74s
```

### 5. Predicate default (the except arm returns True)

```
=== PROOF-01 predicate default: neuter (the except arm returns True) ===
FAILED tests/test_process_key_csv_tier.py::test_the_csv_predicate_refuses_rather_than_skips_on_a_fault
1 failed, 63 passed in 9.41s
cmp exit=0
=== GREEN ===
64 passed in 10.21s
```

## Deviations from Plan

None. The plan was executed as written. Notes that are not deviations:

- The plan's size neuter names "the 20-call and 60-call tests"; they are two separate tests (the 20-call edge test and the 60-then-61 boundary test), each failing by name in block 1. The first neuter run showed one combined test failing, so it was split into two before block 1 was captured, to make each claim fail by its own name.
- Task 2's malformed-csv and strictness tests were green the moment they were written (no exemption existed yet); they were shown RED by the strictness neuter (block 4), as the plan requires. The exemption test, the predicate tests and the hostile-input rows were RED first.
- The hostile-input rows live in `tests/test_tenant_claim_parsing.py` as `TestCsvCeilingPredicateIsTotal` and reach the router through `tests.test_process_key.process_key_router`, never a direct `routers.process_key` import, because a second module object would register a second set of limits on the shared limiter.

## Known limits and flagged assumptions (recorded, not fixed)

- RESEARCH A2: the bucket bound (two edge buckets per exact 60 s span, a third under latency) is a reading of Upstash's documented algorithm, not an Upstash run. 60/minute is the founder-accepted discretion number.
- Deploy skew: until plan 06's TS ships, csv-validate sends a plain tenant claim and keeps today's 100/hour shared bucket; one PR ships both.
- `tenant_or_platform_key` also routes a csv claim to `<scope>:csv:<uuid>`, as the plan specifies. Those single-limit routes size their own limit by a static string, so a csv claim there gets that route's one limit under a csv-named bucket; nothing in TS sends a csv claim to them.
- Single replica with `memory://` storage is still assumed; N replicas multiply every tier by N.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; the claim grammar widens inside the existing signed contract (T-240-13 covers the exemption's trust, T-240-15 the predicate default).

## Self-Check: PASSED

- Created file present: `analytics-service/tests/test_process_key_csv_tier.py`.
- Task commits are ancestors of HEAD: `7d45020ae`, `f15c238fd`.
- `git rev-list --count fe851505297893291ef92b002abc276b8c675536..HEAD` printed 2 before this SUMMARY commit.
- STATE.md and ROADMAP.md untouched.
