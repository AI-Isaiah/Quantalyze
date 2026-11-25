---
phase: 240-connecttruth-validating-a-key-or-a-csv-gets-a-true-answer-an
plan: 02
subsystem: api
tags: [slowapi, rate-limiting, hmac-claim, fastapi, sentry]

requires:
  - phase: 140.1
    provides: the signed X-Tenant-Claim and the shared limiter key functions in services/rate_limit.py
provides:
  - one claim classifier (classify_tenant_claim) that both key functions and the aggregate exemption predicate use
  - a per-IP anonymous bucket (process_key:anon:<32 hex>) at 30/hour behind the public:<32 hex> claim grammar
  - a 200/hour anonymous aggregate (process_key:anon-all) between the per-identity limit and the platform ceiling
  - the /process-key stack in evaluation order identity, aggregate, ceiling, so a refused call spends no shared token
  - the saturation alert re-keyed to the shared and aggregate anonymous keys only
  - a whole-service pin that no non-test module names get_remote_address
affects: [240-04 (csv tier and ceiling exemption share this stack), 240-06 (TS mint of the per-IP pseudonym)]

plan_head_before: c37593fa674a3d5a02a8cbf30ea8b03d69a03790
plan_head_after: 1d71f82f6
actuals:
  tokens: 13560
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "one classifier turns a verified claim payload into a bucket kind; key functions and predicates never re-test the payload"
    - "limit order is registration order bottom-up; every limit on /process-key is a callable provider so static strings cannot jump the queue"

key-files:
  created:
    - analytics-service/tests/test_process_key_anon_ip_tier.py
  modified:
    - analytics-service/services/rate_limit.py
    - analytics-service/routers/process_key.py
    - analytics-service/services/app_error_handlers.py
    - analytics-service/tests/test_tenant_claim_parsing.py
    - analytics-service/tests/test_process_key.py
    - analytics-service/tests/test_limiter_route_coverage.py
    - analytics-service/tests/test_anon_bucket_alert.py
    - analytics-service/tests/test_limiter_identity.py

key-decisions:
  - "A malformed public: suffix is anonymous and shares the legacy bucket; the prefix is reserved and can never reach a :t: tenant bucket"
  - "The aggregate is 200/hour (40 percent of the 500/hour ceiling), founder-retunable, key process_key:anon-all"
  - "The aggregate provider declares no key parameter and uses exempt_when, so tenant traffic never runs its key function"
  - "A fault in the exemption predicate answers not-exempt, so a fault refuses rather than skips a limit"

requirements-completed: [RLIM-01]

coverage:
  - id: D1
    description: "A well-formed public:<32 hex> claim buckets to its own 30/hour window; visitor B is admitted while visitor A is refused"
    requirement: RLIM-01
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_process_key_anon_ip_tier.py#test_two_anonymous_visitors_from_different_ips_do_not_share_a_bucket"
        status: pass
    human_judgment: false
  - id: D2
    description: "Malformed or bare anonymous payloads share the legacy bucket and never reach a tenant bucket"
    requirement: RLIM-01
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_tenant_claim_parsing.py#TestPerIpAnonymousGrammar"
        status: pass
    human_judgment: false
  - id: D3
    description: "Evaluation order is per-identity, anonymous aggregate, platform ceiling; a hammering pseudonym burns no aggregate and no ceiling token"
    requirement: RLIM-01
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_process_key_anon_ip_tier.py#test_a_hammering_pseudonym_burns_no_aggregate_and_no_ceiling_token"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_process_key.py#test_process_key_route_registers_both_limits"
        status: pass
    human_judgment: false
  - id: D4
    description: "The anonymous aggregate refuses past its size across pseudonyms; tenant traffic is exempt"
    requirement: RLIM-01
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_process_key_anon_ip_tier.py#test_the_aggregate_refuses_past_its_size_across_pseudonyms"
        status: pass
    human_judgment: false
  - id: D5
    description: "The saturation alert fires for the shared and aggregate keys only; a 429 carries no IP, pseudonym, claim or bucket key; no non-test module names get_remote_address"
    requirement: RLIM-01
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_anon_bucket_alert.py#test_an_aggregate_refusal_emits_one_tagged_event"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_limiter_identity.py#test_no_non_test_module_in_analytics_service_references_get_remote_address"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-11-24
status: complete
---

# Phase 240 Plan 02: Per-IP anonymous tier and aggregate ceiling on /process-key Summary

**Anonymous /process-key traffic now gets a per-IP 30/hour bucket behind a signed `public:<32 hex>` pseudonym, a 200/hour anonymous aggregate on top, and a stack order (identity, aggregate, ceiling) under which a refused request spends no shared token.**

## Performance

- **Duration:** about 45 min
- **Completed:** 2026-11-24
- **Tasks:** 3 (one tracer, two auto, all TDD)
- **Files modified:** 9 (one new test file)

## Accomplishments

- `classify_tenant_claim` in `services/rate_limit.py` is the one place a verified payload becomes a bucket kind (`anon`, `anon_ip`, `tenant`, `unverified`). Both key functions route through it; the duplicated `payload == ANON_PAYLOAD` test is gone from both. Only `public:` plus exactly 32 lowercase hex (`re.ASCII`, `fullmatch`) is a per-IP pseudonym; every other `public:` payload is the shared anonymous bucket, never a `:t:` bucket. `public-enemy` stays the tenant bucket.
- `/process-key` now carries three callable limits in evaluation order `_process_key_rate_limit_key`, `_process_key_anon_aggregate_key`, `_process_key_ceiling_key`, pinned as a literal list read off `limiter._dynamic_route_limits`. The old comment above the decorators described the opposite order; it is rewritten.
- The 200/hour aggregate (`process_key:anon-all`) is exempt for tenant and unverified traffic through `exempt_when=_process_key_not_anonymous`, whose fault default is not-exempt. Its provider declares no `key` parameter, so the key function runs only for anonymous requests.
- The saturation alert compares the refusing key with `anon_bucket_key` and `anon_aggregate_key`; message, fingerprint and tag are unchanged. A per-IP refusal emits nothing and adds no `_anon_alert_last_at` entry.
- `tests/test_limiter_identity.py` gained a whole-service scan (every non-test `.py` under analytics-service) pinning that nothing names `get_remote_address`. The simulator re-key was already shipped in Phase 163 SEC-05; this plan pins it and corrects the stale prose in `rate_limit.py` (FINDING-10 paragraph, the comment under the imports, the token-cost table).

## Task Commits

1. **Task 1 (tracer): classifier, per-IP key, provider sizing** - `596b73838`
2. **Task 2: stack order and the anonymous aggregate** - `a8a47d41e`
3. **Task 3: alert re-key, 429 hygiene, widened proxy-IP pin, prose** - `1d71f82f6`

## Verification

- Plan verification set (nine test files): `298 passed, 1 warning`.
- CI strict mypy command: `Success: no issues found in 143 source files`.
- `git status --porcelain -- supabase/migrations` printed nothing.
- Acceptance greps: `exempt_when=_process_key_not_anonymous` 1, `@limiter.limit(` 3 in `routers/process_key.py`, `dynamic[key] == 2` 0 and `== 3` 1, `cannot see the request` 0, `Inner = per-identity` 0, `(FINDING-10) may key on` 0, `see FINDING-10 below` 0, `anon_aggregate_key` 3 in `app_error_handlers.py`, the Sentry message 1 (byte-stable).

## PROOF-01 (nine neuters, each on a byte backup restored with cp)

Every block is the verbatim output. Pytest was run with `-q -p no:cacheprovider` from `analytics-service/`. A stray line in two blocks ("run before callable ones, ...") is a fragment the filtering grep matched in the captured output; it is left as captured.

### 1. Grammar (classifier returns kind anon for a well-formed per-IP payload)

```
=== PROOF-01 grammar: neuter ===
FAILED tests/test_process_key_anon_ip_tier.py::test_two_anonymous_visitors_from_different_ips_do_not_share_a_bucket
FAILED tests/test_process_key_anon_ip_tier.py::test_ipv6_pseudonym_is_one_more_distinct_visitor
FAILED tests/test_process_key_anon_ip_tier.py::test_a_bare_public_claim_still_shares_the_one_legacy_bucket
FAILED tests/test_tenant_claim_parsing.py::TestPerIpAnonymousGrammar::test_a_well_formed_per_ip_payload_gets_its_own_bucket_on_both_key_functions
FAILED tests/test_tenant_claim_parsing.py::TestPerIpAnonymousGrammar::test_the_classifier_truth_table[public:0123456789abcdef0123456789abcdef-anon_ip]
5 failed, 37 passed in 39.25s
cmp exit=0
=== GREEN ===
42 passed in 26.08s
```

### 2. Reserved prefix (malformed per-IP payload sent to kind tenant)

```
=== PROOF-01 reserved prefix: neuter ===
FAILED tests/test_process_key_anon_ip_tier.py::test_a_malformed_per_ip_suffix_shares_the_legacy_bucket_never_a_tenant_bucket[31-hex]
FAILED tests/test_process_key_anon_ip_tier.py::test_a_malformed_per_ip_suffix_shares_the_legacy_bucket_never_a_tenant_bucket[33-hex]
FAILED tests/test_process_key_anon_ip_tier.py::test_a_malformed_per_ip_suffix_shares_the_legacy_bucket_never_a_tenant_bucket[uppercase]
FAILED tests/test_process_key_anon_ip_tier.py::test_a_malformed_per_ip_suffix_shares_the_legacy_bucket_never_a_tenant_bucket[non-hex]
FAILED tests/test_process_key_anon_ip_tier.py::test_a_malformed_per_ip_suffix_shares_the_legacy_bucket_never_a_tenant_bucket[empty]
FAILED tests/test_tenant_claim_parsing.py::TestPerIpAnonymousGrammar::test_a_malformed_suffix_falls_to_the_shared_anon_bucket_never_a_tenant_bucket[31-hex]
FAILED tests/test_tenant_claim_parsing.py::TestPerIpAnonymousGrammar::test_a_malformed_suffix_falls_to_the_shared_anon_bucket_never_a_tenant_bucket[33-hex]
FAILED tests/test_tenant_claim_parsing.py::TestPerIpAnonymousGrammar::test_a_malformed_suffix_falls_to_the_shared_anon_bucket_never_a_tenant_bucket[uppercase]
FAILED tests/test_tenant_claim_parsing.py::TestPerIpAnonymousGrammar::test_a_malformed_suffix_falls_to_the_shared_anon_bucket_never_a_tenant_bucket[non-hex]
FAILED tests/test_tenant_claim_parsing.py::TestPerIpAnonymousGrammar::test_a_malformed_suffix_falls_to_the_shared_anon_bucket_never_a_tenant_bucket[empty]
FAILED tests/test_tenant_claim_parsing.py::TestPerIpAnonymousGrammar::test_the_hex_is_matched_as_a_whole_not_as_a_prefix
FAILED tests/test_tenant_claim_parsing.py::TestPerIpAnonymousGrammar::test_a_non_ascii_digit_run_is_not_hex
FAILED tests/test_tenant_claim_parsing.py::TestPerIpAnonymousGrammar::test_the_classifier_truth_table[public:short-anon]
FAILED tests/test_tenant_claim_parsing.py::TestPerIpAnonymousGrammar::test_every_anonymous_shape_classifies_as_anonymous
14 failed, 28 passed in 9.02s
cmp exit=0
=== GREEN ===
42 passed in 9.07s
```

### 3. Order (ceiling decorator moved to the bottom of the stack)

```
=== PROOF-01 order: neuter (ceiling decorator moved to the bottom) ===
        run before callable ones, so a limit passed as a plain string would jump the
FAILED tests/test_process_key_anon_ip_tier.py::test_the_stack_evaluates_identity_then_aggregate_then_ceiling
FAILED tests/test_process_key_anon_ip_tier.py::test_a_hammering_pseudonym_burns_no_aggregate_and_no_ceiling_token
FAILED tests/test_process_key.py::test_process_key_route_registers_both_limits
3 failed, 9 passed, 125 deselected in 14.14s
cmp exit=0
=== GREEN ===
12 passed, 125 deselected in 13.94s
```

### 4. Aggregate (aggregate decorator removed)

```
=== PROOF-01 aggregate: neuter (aggregate decorator removed) ===
        run before callable ones, so a limit passed as a plain string would jump the
FAILED tests/test_process_key_anon_ip_tier.py::test_the_stack_evaluates_identity_then_aggregate_then_ceiling
FAILED tests/test_process_key_anon_ip_tier.py::test_the_aggregate_refuses_past_its_size_across_pseudonyms
FAILED tests/test_process_key_anon_ip_tier.py::test_tenant_calls_never_consume_an_aggregate_slot
FAILED tests/test_process_key.py::test_process_key_route_registers_both_limits
FAILED tests/test_limiter_route_coverage.py::TestRouteLimitCoverage::test_the_dynamic_limit_arm_still_holds_process_key
5 failed, 7 passed, 125 deselected in 14.69s
cmp exit=0
=== GREEN ===
12 passed, 125 deselected in 12.39s
```

### 5. Static provider (aggregate limit passed as the string 200/hour)

```
=== PROOF-01 static provider: neuter (aggregate limit passed as the string 200/hour) ===
FAILED tests/test_process_key_anon_ip_tier.py::test_the_stack_evaluates_identity_then_aggregate_then_ceiling
FAILED tests/test_process_key_anon_ip_tier.py::test_the_aggregate_refuses_past_its_size_across_pseudonyms
FAILED tests/test_process_key_anon_ip_tier.py::test_tenant_calls_never_consume_an_aggregate_slot
FAILED tests/test_process_key.py::test_process_key_route_registers_both_limits
FAILED tests/test_limiter_route_coverage.py::TestRouteLimitCoverage::test_the_dynamic_limit_arm_still_holds_process_key
5 failed, 7 passed, 125 deselected in 14.07s
cmp exit=0
=== GREEN ===
12 passed, 125 deselected in 14.81s
```

### 6. Predicate default (the except arm returns True)

```
=== PROOF-01 predicate default: neuter (except arm returns True) ===
FAILED tests/test_process_key_anon_ip_tier.py::test_the_exemption_predicate_refuses_rather_than_skips_on_a_fault
1 failed, 11 passed, 125 deselected in 13.10s
cmp exit=0
=== GREEN ===
12 passed, 125 deselected in 12.21s
```

### 7. Alert (alert on any key starting with process_key:anon)

```
=== PROOF-01 alert: neuter (alert on any key starting with process_key:anon) ===
FAILED tests/test_anon_bucket_alert.py::test_a_per_ip_refusal_emits_no_event_and_grows_no_dedupe_entry
1 failed, 107 passed, 1 warning in 9.95s
cmp exit=0
=== GREEN ===
108 passed, 1 warning in 9.80s
```

### 8. Hygiene (refusing key appended to the 429 detail)

```
=== PROOF-01 hygiene: neuter (refusing key appended to the 429 detail) ===
FAILED tests/test_anon_bucket_alert.py::test_a_raising_capture_still_returns_the_identical_429
FAILED tests/test_process_key_anon_ip_tier.py::test_a_per_ip_refusal_leaks_no_identity_in_body_headers_or_the_handler_log
2 failed, 106 passed, 1 warning in 10.16s
cmp exit=0
=== GREEN ===
108 passed, 1 warning in 9.90s
```

### 9. Pin (a NAME use of get_remote_address added to a services module)

```
=== PROOF-01 pin: neuter (NAME use of get_remote_address added to services/db.py, byte backed) ===
FAILED tests/test_limiter_identity.py::TestClassClosure::test_no_non_test_module_in_analytics_service_references_get_remote_address
1 failed, 107 passed, 1 warning in 10.11s
cmp exit=0
=== GREEN ===
108 passed, 1 warning in 9.67s
```

The failing assertion names the offender (re-run on the same neuter, filtered):

```
E       AssertionError: get_remote_address references changed outside tests/. The quarantine is EMPTY — nothing in analytics-service may key on the proxy IP — but found ['services/db.py'].
FAILED tests/test_limiter_identity.py::TestClassClosure::test_no_non_test_module_in_analytics_service_references_get_remote_address
cmp exit=0
```

## Deviations from Plan

None. The plan was executed as written. Two notes that are not deviations:

- The aggregate-refusal Sentry test (the only Task 3 test that was RED before the alert change) was RED first; the per-IP-silent, hygiene and widened-scan tests were green at the moment they were written, because the existing equality alert and the existing handler already satisfied them. They were each shown RED by neutering (blocks 7, 8, 9), as the plan requires.
- In the neuter blocks 3 to 5, extra tests beyond the named ones also go red (for example the aggregate test under the static-provider neuter, because a string limit ignores the monkeypatched size). The named tests are in every list.

## Known limits and flagged assumptions (recorded, not fixed)

- slowapi's own `ratelimit ... exceeded` warning prints the bucket key, so it may carry the keyed pseudonym. CONTEXT ruled no logging filter; the hygiene test pins what this service writes and sends, not the library line.
- `tenant_or_platform_key` (the nine ex-IP-keyed routes) also routes a per-IP payload to `<scope>:anon:<hex>` through the classifier, as the plan's truth table requires. Those routes carry no aggregate. Whether TS ever mints a `public:` claim for them is a plan 06 question; nothing in this plan changes their limits.
- Deploy skew (plan Flagged assumptions): Vercel deploys before Railway, so for that gap new TS runs against old Python, where `public:<hex>` lands in a 100/hour tenant bucket. Benign, closes when Railway deploys.
- Single replica with `memory://` storage is still assumed; N replicas multiply every tier by N.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; the claim grammar widens inside the existing signed contract (T-240-05 covers it).

## Self-Check: PASSED

- Created file present: `analytics-service/tests/test_process_key_anon_ip_tier.py`.
- Task commits are ancestors of HEAD: `596b73838`, `a8a47d41e`, `1d71f82f6`.
- `git rev-list --count c37593fa674a3d5a02a8cbf30ea8b03d69a03790..HEAD` printed 3 before this SUMMARY commit.
- STATE.md and ROADMAP.md untouched.

## Addendum — review finding (MEDIUM), closed by the phase orchestrator 2026-11-24

An automated security review flagged that `tenant_or_platform_key` gave a `public:<32 hex>` claim its own per-IP bucket on the single-limit routes, which have no aggregate anonymous ceiling above them. Fix: on those routes every anonymous claim (`anon` and `anon_ip`) folds into the one shared `<scope>:anon` bucket. `/process-key` keeps its per-IP buckets under the 200/hour aggregate (the HIGH finding from the same review is the aggregate this plan already shipped in `a8a47d41e`). Pin: `TestPerIpAnonymousGrammar::test_a_per_ip_payload_shares_the_one_anon_bucket_on_the_single_limit_routes`.

PROOF-01 (byte backup of `services/rate_limit.py`, neuter restores the per-IP arm in `tenant_or_platform_key`):

```
FAILED tests/test_tenant_claim_parsing.py::TestPerIpAnonymousGrammar::test_a_per_ip_payload_shares_the_one_anon_bucket_on_the_single_limit_routes
1 failed, 31 deselected in 9.12s
cmp exit 0
1 passed, 31 deselected in 8.53s
```

IPv6 /64 truncation was considered and not taken: CONTEXT rules addresses are hashed as given because the `/process-key` aggregate bounds rotation, and with this fix no other route gives an anonymous address its own window.
