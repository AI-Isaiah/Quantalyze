---
phase: 240-connecttruth-validating-a-key-or-a-csv-gets-a-true-answer-an
plan: 06
subsystem: api
tags: [rate-limiting, hmac-claim, tenant-claim, nextjs, fixture-parity]

requires:
  - phase: 240-02
    provides: public:<32 hex> classified in Python as process_key:anon:<hex>
  - phase: 240-04
    provides: csv:<uuid> classified in Python as process_key:csv:<uuid>
provides:
  - anonymousClaimPayload, the one producer of anonymous claim payloads
  - PostProcessKeyArgs.clientIp and the payload derivation (anonymous, csv, plain) inside postProcessKey's mint try
  - the verify-strategy teaser passing the Vercel-read client IP
  - tenant-claim-parity.json with per-IP, csv and malformed public: cases and bucket_process_key on every case
  - test_every_case_buckets_to_its_committed_key, the Python half of the grammar binding
affects: [240-07, 240-08]

plan_head_before: 3e0bd6dd1b0cd1aefa5451d48659dfcd944134f0
plan_head_after: 38e85676ca328552b8f1cd1864f087d501a19872
actuals:
  tokens: 9200
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "claim payload derived inside the one chokepoint (postProcessKey) from userId, clientIp and flow_type, so no route can forget it"
    - "a committed fixture binds the TS mint and the Python bucket classifier to the same payload shapes"

key-files:
  created: []
  modified:
    - src/lib/tenant-claim.ts
    - src/lib/process-key-client.ts
    - src/app/api/verify-strategy/route.ts
    - src/app/api/verify-strategy/route.test.ts
    - src/lib/process-key-client.test.ts
    - src/lib/tenant-claim.test.ts
    - tests/fixtures/tenant-claim-parity.json
    - analytics-service/tests/test_tenant_claim_parity.py

key-decisions:
  - "The derivation order is public first, then csv, then the plain user id, so a csv flow with userId public still yields the anonymous family"
  - "IPv6 is hashed as given, no /64 normalisation (CONTEXT discretion)"
  - "The route threads ip into unifiedVerifyStrategyHandler as a second parameter; ip was computed in POST, not in the handler that makes the postProcessKey call"

requirements-completed: [RLIM-01, RLIM-02]

status: complete
---

# Phase 240 Plan 06: The claim chokepoint mints per-IP anonymous and csv-scoped payloads Summary

**The teaser now sends a keyed per-IP pseudonym (`public:<32 hex>`, HMAC-SHA256 under the internal token over `anon-ip:<ip>`), CSV validations send `csv:<user id>`, both derived inside `postProcessKey`, and a committed fixture binds the TS mint to the Python buckets for every payload shape.**

## Accomplishments

- `anonymousClaimPayload(ip, secret)` in `src/lib/tenant-claim.ts`: bare `public` for an empty, whitespace-only or `unknown` IP; otherwise `public:` plus the first 32 hex of the keyed digest. Dot-free (mint guards 1-3 untouched), IPv6 hashed as given.
- `postProcessKey` gained optional `clientIp` and derives the payload inside the existing mint try: `userId === "public"` goes through `anonymousClaimPayload(args.clientIp ?? "unknown", token)`, then `flow_type === "csv"` gives `csv:<userId>`, else the plain user id. A mint failure keeps the existing 503 refusal path. `X-User-Id` stays `args.userId` (the literal `public` on the teaser). No console call added (count stays 7), the `retriesOverride` line is untouched, `publicIpLimiter` is not retuned.
- The raw IP appears in no header value, no request body and no console call (T-240-20), pinned by a test that spies on all five console methods.
- verify-strategy passes `clientIp: ip`. `ip` is computed in `POST` for `publicIpLimiter`, so it is threaded into `unifiedVerifyStrategyHandler` as a second parameter (the plan said it was already in scope; it was not).
- Fixture: `public-per-ip` (ip 203.0.113.7), `csv-scoped`, `public-malformed-suffix` added, and `bucket_process_key` on all 7 cases. TS reproduces the per-IP payload from `ip` and `secret`; Python buckets every case to its committed key.

## Fixture generation (provenance)

The three new claims were computed once by a standalone `node -e` process requiring only `node:crypto`, secret `internal-test-token`, exp `2524608300`:

```
hm = (k, m) => createHmac("sha256", k).update(m).digest("hex")
per-IP payload = "public:" + hm(secret, "anon-ip:" + ip).slice(0, 32)
claim          = payload + "." + exp + "." + hm(secret, payload + "." + exp)
```

The command shape is recorded in the fixture's `_comment`. Result: `public-per-ip` -> `process_key:anon:5f383e52cfee255855bfdcca61f9b650`; `csv-scoped` (`csv:22222222-3333-4444-8555-666666666666`) -> `process_key:csv:22222222-3333-4444-8555-666666666666`; `public-malformed-suffix` (`public:not-hex`) -> `process_key:anon`.

## Task Commits

1. **Task 1 (tracer): per-IP pseudonym route -> postProcessKey -> X-Tenant-Claim** - `1f3d090a1`
2. **Task 2: csv scope, pseudonym unit contract, fixture and Python bucket binding** - `35d3c1181`
3. Docblock wording fix on `PostProcessKeyArgs.userId` (no behaviour change) - `38e85676c`

## Verification

- Plan verification set (10 files: tenant-claim, analytics-client, process-key-client in both locations, verify-strategy, thin-adapters, csv-validate-route, seam-log-coverage, critical-regressions): `Test Files 10 passed, Tests 612 passed`.
- `cd analytics-service && python -m pytest tests/test_tenant_claim_parity.py tests/test_tenant_claim_parsing.py tests/test_process_key_anon_ip_tier.py tests/test_process_key_csv_tier.py`: `99 passed`.
- `npm run typecheck` and `npm run lint` both exit 0.
- CI strict mypy command (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 143 source files`. Only a test file changed in analytics-service, so the surface did not move.
- Acceptance greps: `export function anonymousClaimPayload` 1, `anonymousClaimPayload` in process-key-client.ts 4, `clientIp: ip` 1, `console.` 7, `retriesOverride: retriesForFlow(args.flow_type, args.context),` 1, `publicIpLimiter = makeLimiter(10, "60 s")` 1, `"bucket_process_key"` 7, `["csv", "u3"]` 0, `def test_every_case_buckets_to_its_committed_key` 1. `git status --porcelain -- supabase/migrations` printed nothing.

## PROOF-01 (six neuters, each on a byte backup restored with cp, then cmp, then GREEN)

Verbatim outputs, vitest filtered to its failing-test and summary lines, pytest run from `analytics-service/` with `-q -p no:cacheprovider`.

### T1a. Mint (anonymousClaimPayload always returns public)

```
=== PROOF-01 T1a mint: anonymousClaimPayload always returns public ===
     × mints public:<32 hex> from the Vercel-read client IP on the teaser path (RLIM-01) 10ms
 Test Files  1 failed (1)
      Tests  1 failed | 58 passed (59)
cmp exit=0
=== GREEN ===
 Test Files  1 passed (1)
      Tests  59 passed (59)
```

### T1b. Raw IP (X-User-Id header set to the client IP)

```
=== PROOF-01 T1b raw IP: X-User-Id header set to the client IP ===
     × mints public:<32 hex> from the Vercel-read client IP on the teaser path (RLIM-01) 12ms
     × never lets the raw client IP reach a header, the request body or a console call (T-240-20) 5ms
 Test Files  1 failed (1)
      Tests  2 failed | 57 passed (59)
cmp exit=0
=== GREEN ===
 Test Files  1 passed (1)
      Tests  59 passed (59)
```

### T1c. Route (clientIp: ip dropped)

```
=== PROOF-01 T1c route: drop clientIp: ip ===
     × RLIM-01: the teaser hands postProcessKey the Vercel-read client IP (getClientIp) with userId 'public' 12ms
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 52 passed (53)
cmp exit=0
=== GREEN ===
 Test Files  2 passed (2)
      Tests  53 passed (53)
```

### T2a. csv scope (csv arm dropped)

```
=== PROOF-01 T2a csv scope: csv arm dropped ===
     × attaches X-Tenant-Claim on the csv flow (one shared headers assembly) 13ms
     × the csv scope signs the user id, and X-User-Id stays the bare user id 5ms
 Test Files  1 failed (1)
      Tests  2 failed | 62 passed (64)
cmp exit=0
=== GREEN ===
 Test Files  1 passed (1)
      Tests  64 passed (64)
```

### T2b. Cross-language (one hex character of the per-IP payload changed, claim left as is)

```
=== PROOF-01 T2b cross-language: one hex char of the per-IP payload changed, claim left as is ===
     × round-trips fixture case public-per-ip through the shipped mint 13ms
     × fixture case public-per-ip is internally consistent under an independently computed HMAC 3ms
     × committed fixture case public-per-ip: the per-IP payload is exactly what the shipped derivation produces 2ms
 Test Files  1 failed (1)
      Tests  3 failed | 35 passed (38)
FAILED tests/test_tenant_claim_parity.py::test_verify_tenant_claim_accepts_the_committed_bytes[public-per-ip]
1 failed, 14 passed in 31.42s
cmp exit=0
=== GREEN ===
 Test Files  1 passed (1)
      Tests  38 passed (38)
15 passed in 30.57s
```

### T2c. Python bucket binding (one hex character of the per-IP bucket_process_key changed)

The plan expected T2b to redden the Python bucket test too. It does not, by construction: the bucket test classifies the verified `claim`, and T2b left the claim intact, so only the verify test (which compares the verified payload with the `payload` field) fails. T2c is the neuter that bites the bucket assertion.

```
=== PROOF-01 T2c bucket binding: one hex char of the per-IP bucket_process_key changed ===
FAILED tests/test_tenant_claim_parity.py::test_every_case_buckets_to_its_committed_key[public-per-ip]
1 failed, 14 passed in 29.71s
cmp exit=0
=== GREEN ===
15 passed in 31.03s
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `ip` not in scope at the teaser postProcessKey call**
- **Found during:** Task 1, first run after implementing
- **Issue:** the plan said `ip` was already computed for `publicIpLimiter`; it is computed in `POST`, while the `postProcessKey` call lives in `unifiedVerifyStrategyHandler`. Result was a `ReferenceError` in 18 route tests.
- **Fix:** `unifiedVerifyStrategyHandler(body, ip)`, one extra parameter and one extra argument at its single call site.
- **Files modified:** `src/app/api/verify-strategy/route.ts`
- **Commit:** `1f3d090a1`

**2. [Documentation] PROOF-01 cross-language neuter needed a third arm**
- See T2c above; no code change.

## Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; the signed claim payload grammar was widened as the plan states.

## Notes for the orchestrator and later plans

- `analytics-service/services/rate_limit.py` (plan 04) describes the csv scope as signed "when `flow_type` is `csv_validate`". The TS flow type is `csv`; the prose is stale. Not touched here (outside this plan's files).
- The new TS runs against old Python for the deploy window described in the plan: a per-IP claim lands in `process_key:t:public:<hex>` and a `csv:` claim in `process_key:t:csv:<uuid>`, both at the 100/hour tenant tier. Benign, closes when Railway deploys.

## Self-Check: PASSED

- Created/modified files exist: all 8 key-files present and committed.
- Commits `1f3d090a1`, `35d3c1181`, `38e85676c` are ancestors of HEAD.
- STATE.md and ROADMAP.md untouched.
