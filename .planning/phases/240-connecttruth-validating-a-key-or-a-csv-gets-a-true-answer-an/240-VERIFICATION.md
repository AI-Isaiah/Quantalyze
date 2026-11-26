---
phase: 240-connecttruth-validating-a-key-or-a-csv-gets-a-true-answer-an
verified: 2026-11-24T22:10:00Z
status: passed
score: 5/5 must-haves verified
verified_at_sha: 549f3d9775cb517f54f9317cf62255b74043a125
drift_subjects:
  - analytics-service/routers/exchange.py
  - analytics-service/routers/internal.py
  - analytics-service/routers/process_key.py
  - analytics-service/services/rate_limit.py
  - analytics-service/services/csv_validator.py
  - analytics-service/services/error_contract.py
  - analytics-service/services/app_error_handlers.py
  - analytics-service/docs/STATUS_CONTRACT.md
  - src/lib/tenant-claim.ts
  - src/lib/process-key-client.ts
  - src/lib/ratelimit.ts
  - src/lib/wizardErrors.ts
  - src/app/api/verify-strategy/route.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - tests/lib/csv-limit-agreement.test.ts
  - tests/fixtures/tenant-claim-parity.json
  - analytics-service/tests/fixtures/validate_key_permanent_400_contract.json
behavior_unverified: 0
overrides_applied: 0
advisory:
  - finding: "Ceiling exemption for a csv claim is decided by the signed claim alone, with no check that the body is a CSV flow (review IN-01)"
    category: other
    reason: "LOW, recorded in 240-REVIEW.md only. The claim is HMAC-signed by Vercel and the scope is derived from the closed FlowType union."
    evidence_status: "none provided"
---

> **verified_at_sha rebound 2026-11-25 (records PR).** The verdict was issued on phase-branch commit `0a6611c9a`, which is not reachable from `main` after the squash merge. It is rebound to the merge commit `549f3d977` (#1334) so that `scripts/verification-drift-report.mjs` can diff from a reachable commit. None of the files listed in `drift_subjects` differs between the two commits (`git diff --name-only 0a6611c9a 549f3d977 -- <drift_subjects>` is empty), so the rebind changes nothing about what was verified.

# Phase 240: CONNECTTRUTH Verification Report

**Phase Goal:** Validating a key or a CSV gets a true answer, and the anonymous and CSV rate limits match the buckets behind them (one error code on every venue, CSV month-name cells, anonymous bucket fairness, edge and upstream CSV limits agree).
**Verified:** 2026-11-24
**Status:** passed
**Re-verification:** No, initial verification
**Worktree / HEAD:** `quantalyze-wt-240`, branch `gsd/phase-240-connecttruth`, `0a6611c9a1ffbb3c5b021e37e069e329bb89c5c8`

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP success criterion) | Status | Evidence |
|---|---|---|---|
| 1 | Every validate-key 400 body carries the same machine-readable code field on every venue; a test per venue reads it (CONN-05) | VERIFIED | Every 400 raise in the validate-key path (`validate_key`, `_validate_sfox_key`, `_validate_mt5_key`, `_validate_mt5_key_probe`, nested `_connect_and_probe`) in `routers/exchange.py` is a `VenueTransientHTTPException(status_code=400, code=..., recoverable=False)`. Codes: `AUTH_FAILED`, `MT5_WRONG_SERVER`, `MT5_MASTER_PASSWORD`, `VENUE_DISABLED`, `INVALID_REQUEST`. The ccxt arm was already coded (`test_c6_permanent_auth_failure_is_not_recoverable` reads `code`). Per-venue tests in `tests/test_validate_key_permanent_400.py`: sFOX P1 to P3 and P9, MT5 P4 to P8 and P10, create_exchange P11, plus an adjacency test. Each drives the real route through `main.app` and compares the body to the committed literal fixture. `TestNoRaw400OnValidateKeyArms` is an AST census proving no bare `HTTPException(400)` remains in scope, with non-vacuity checks (it sees the deliberate `fetch_trades` 400). The detail strings are byte-identical, so the TS wizard verdict is unchanged (`tests/lib/validate-key-permanent-400-parity.test.ts`). The MT5 rotate-secret go-dark gap is closed in `routers/internal.py` with the same flat `VENUE_DISABLED` body. The other two findings are fixed: `routers/process_key.py` passes `recoverable=False if val.permanent is True else None`, with a plumbing test file. `STATUS_CONTRACT.md` has zero `path:line` coordinates outside the S-table (grep returned none; the base commit had 43 in the file). The S-table carries a dated note recording why its coordinates may rot. |
| 2 | A month-name date cell in a numeric-date column is parsed, or rejected naming cell and format, per the founder ruling (CONN-06) | VERIFIED | Ruling was "parse". Independent run: `13/03/2024, 14 Mar 2024, 15/03/2024, 16/03/2024` through `validate_csv(..., "daily_returns")` returns `ok: True`, all four ISO dates, and an info flag `date_format_normalized`, `detected_format: month_name`, message "Read 1 date written with a month name (such as 12 Mar 2024) and normalized it to YYYY-MM-DD." An unreadable month spelling (`12 Foo 2024`) is still rejected as a row error at its row. Covered in `tests/test_csv_validator_date_format_2026_05_27.py` (first, mid and last row; DD/MM, MM/DD and ISO columns; daily_returns, daily_nav, trades; rejecting exits; flag wording). The round-1 and round-3 review MEDIUMs (WR-01, WR-02) are fixed with pinning tests. |
| 3 | Several anonymous visitors from different IPs cannot exhaust the shared anonymous verify-strategy bucket, and no limit is keyed on the proxy's IP (RLIM-01) | VERIFIED | TS: `anonymousClaimPayload` in `src/lib/tenant-claim.ts` mints `public:<32 hex>` from a keyed HMAC of the Vercel-read `getClientIp`, derived inside the `postProcessKey` chokepoint. `verify-strategy/route.ts` passes `clientIp: ip`. Python: `services/rate_limit.py` `classify_tenant_claim` gives `process_key:anon:<hex>` at 30/hour per IP (`_PROCESS_KEY_ANON_LIMIT`). A malformed `public:` suffix folds into the shared anon bucket and can never reach a tenant bucket. A 200/hour anonymous aggregate (`_PROCESS_KEY_ANON_AGGREGATE_LIMIT`) sits under the 500/hour ceiling, with stack order identity, then aggregate, then ceiling. Tests in `tests/test_process_key_anon_ip_tier.py`: different IPs do not share a bucket, per-IP N and N+1 boundary, aggregate refusal across pseudonyms, a hammering pseudonym burns no aggregate or ceiling token, and no identity leaks in a 429 body, headers or log. Cross-language parity fixture `tests/fixtures/tenant-claim-parity.json` is read by both the pytest and vitest consumers. "No proxy-IP key": `get_remote_address` appears in `services/rate_limit.py` only in comments (the source-token scan in `test_limiter_identity.py` is extended from `routers/` to every non-test module and asserts an empty offender set). `internal.py`'s `request.client.host` is audit-log metadata, not a limit key. FINDING-10 prose is corrected (the simulator was re-keyed in Phase 163). |
| 4 | A signed-in user validating a CSV within the edge limit never gets an upstream 429; edge and upstream agree; the limiter docblock cites the current upstream cap (RLIM-02, with the dated CORRECTED note) | VERIFIED | Per the founder ruling the agreement is a CSV-scoped per-tenant tier, not a retuned shared tier. `postProcessKey` signs `csv:<userId>` when `flow_type === "csv"`. Python's strict classifier (`fullmatch` on a canonical lowercase uuid) keys `process_key:csv:<uuid>`. `_PROCESS_KEY_CSV_LIMIT = "60/minute"`, and the platform-ceiling decorator is `exempt_when=_process_key_is_csv_scoped`, which answers False on a fault. The shared tenant tier stays `100/hour`. The edge is `csvValidateLimiter = makeLimiter(20, "60 s")`, and csv-finalize has its own `csvFinalizeLimiter` (20 per 60 s; route switched). The docblock above `csvValidateLimiter` now cites `_PROCESS_KEY_CSV_LIMIT` (60/minute, exempt from the ceiling) and the stale "30/hour cap" sentence is gone (grep of `src/` for `30/hour` returns nothing). `tests/lib/csv-limit-agreement.test.ts` has zero mocks, hand-typed expectations and parse-before-compare. It pins edge 20 per 60 s, upstream 60/minute, upstream at least 3x edge, and the docblock cites the symbol and neither stale phrase. `tests/test_process_key_csv_tier.py` covers 20 edge-rate validations never refused upstream, the 60 admit and 61st refuse boundary, separation from the tenant bucket, admission after ceiling saturation, and a malformed `csv:` payload getting no exemption. |
| 5 | PROOF-01: each gate goes RED on a neutered copy with its named arm, is restored from a byte backup (`cp`, `cmp`), goes GREEN, recorded verbatim in every plan SUMMARY | VERIFIED | Every one of the eight SUMMARYs has a `## PROOF-01` section with verbatim pytest or vitest output: 01 has 6 neuters, 02 has 9, 03 has 5, 04 has 5, 05 has 6, 06 has 6, 07 has 4, 08 has 4. Each shows a named RED test or arm, `cmp exit 0` and a GREEN run. Spot-read of 03 confirms real failure text (`got ['detail']`, `ZZ_NO_ROSTER_ROW`, `KeyError: 'mt5_master_password'`) and `cmp exit 0` followed by passing counts. Two honest limits: (a) 08's STATUS_CONTRACT coordinate check is a measured grep count (43 at base, 0 outside the S-table now, independently reproduced), not a test file, so it has no neuter pair, and the SUMMARY says so. (b) Plans 03 and 05 print `RESTORED` plus a pass count instead of the literal word `GREEN`. I did not re-run the neuters (read-only). |

**Score:** 5/5 truths verified, 0 behavior-unverified (the rate-limit and 400-body behaviors are exercised by live-TestClient tests that I ran).

### Required Artifacts and Key Links

| Artifact / link | Status | Details |
|---|---|---|
| `routers/exchange.py` flat coded 400 arms | VERIFIED, wired | Raised through the real `main.app` exception handler stack, asserted by the real-route tests |
| `routers/internal.py` rotate-secret MT5 gate | VERIFIED | `VENUE_DISABLED` flat 400 after the token, rate-limit, 404 and 422 arms, before the KEK load; `tests/test_mt5_rotate_secret_internal.py` |
| `services/rate_limit.py` `classify_tenant_claim` to key functions to `process_key.py` providers | VERIFIED | One classifier feeds both key functions and both `exempt_when` predicates; the alert in `services/app_error_handlers.py` follows the re-key (`tests/test_anon_bucket_alert.py`) |
| `src/lib/process-key-client.ts` to `tenant-claim.ts` to Python classifier | VERIFIED | Shared fixture `tenant-claim-parity.json` is read by both languages; a one-hex-character change fails |
| `verify-strategy/route.ts` to `postProcessKey(clientIp)` | VERIFIED | Route test asserts `clientIp` is the `getClientIp` value with `userId: "public"` |
| `csv-validate/route.ts` to `postProcessKey({flow_type: "csv"})` | VERIFIED | Same `userId` is the signed `csv:` identity |
| `csv-finalize/route.ts` to `csvFinalizeLimiter` | VERIFIED | Imported and passed to `checkLimit` |
| `src/lib/wizardErrors.ts` entries for the new codes | VERIFIED | `tests/lib/validate-key-permanent-400-parity.test.ts` and `seam-venue-vocabulary.invariant.test.ts` pass |

### Behavioral Spot-Checks and Test Runs (mine, at 0a6611c9a)

| Check | Command | Result |
|---|---|---|
| Phase Python suite, 14 files | `.venv/bin/python -m pytest -q -x -p no:cacheprovider` over the phase test files plus `test_process_key`, `test_raw_5xx_census`, `test_validate_key_venue_transient` | 535 passed |
| Phase TS suite, 8 files | `npx vitest run` over `process-key-client`, `tenant-claim`, `verify-strategy/route`, `csv-finalize/route`, `seam-venue-vocabulary.invariant`, `csv-limit-agreement`, `validate-key-permanent-400-parity`, `csv-validate-route` | 297 passed |
| Strict mypy on the six changed router and service modules | `mypy --strict --follow-imports=silent --config-file=pyproject.toml ...` | no issues |
| Month-name parse, run by hand | `validate_csv` on a DD/MM column with `14 Mar 2024` | `ok: True`, flag `month_name` |

I did not re-run the full suites. The orchestrator's figures (15939 passed Python, vitest failures isolated to `src/lib/factsheet/compute.conventions.test.ts`, which also fails on the untouched base b752182dc) are noted and not relied on.

### Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| CONN-05 | SATISFIED | SC-1; permanence plumbing and the STATUS_CONTRACT coordinates are fixed, with the S-table recorded as a census |
| CONN-06 | SATISFIED | SC-2 |
| RLIM-01 | SATISFIED | SC-3 |
| RLIM-02 | SATISFIED | SC-4, per the CORRECTED founder ruling |

All four requirement IDs appear in plan frontmatter. No orphaned requirement.

### Anti-Patterns Found

No `TBD`, `FIXME` or `XXX` in the touched source files. No stubs: every new function is called and tested.

### Advisory (recorded, non-blocking)

- Review IN-01 to IN-06 (LOW and INFO) are recorded in `240-REVIEW.md` only, per the repo rule. Notable: the ceiling exemption trusts the signed claim alone (IN-01); a deploy-skew window between the Vercel and Railway releases is accepted (IN-06).
- The teaser UI is rendered by no page (`[192-ORPHANED-LANDING-VERIFY]`). The route is public, so the RLIM-01 fix still serves direct calls. This is not part of this phase's goal.
- The anonymous aggregate (200/hour) can be spent by address rotation. That is the founder-accepted bound (CONTEXT, "the anonymous aggregate ceiling bounds address rotation"), not a defect against SC-3.
- `memory://` limiter correctness rests on the measured 1 replica and 1 uvicorn worker (CONTEXT). Re-read this if the Railway deploy config changes.

### Human Verification Required

None. No visual or external-service truth is part of the success criteria.

### Gaps Summary

No gaps. All five success criteria are backed by code I read and tests I ran. The adversarial points I checked and found sound:

- No bare 400 survives in the validate-key path (the AST census is non-vacuous).
- The `get_remote_address` pin is an empty offender set across the whole service.
- The csv exemption is strict (a malformed `csv:` payload gets the tenant tier and no exemption) and fails closed on a fault.
- The edge and upstream numbers are tied by a zero-mock cross-file test and the docblock cites the real symbol.

---

_Verified: 2026-11-24_
_Verifier: Claude (gsd-verifier)_
