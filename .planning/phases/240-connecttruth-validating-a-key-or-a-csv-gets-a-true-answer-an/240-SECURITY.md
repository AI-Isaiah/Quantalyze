---
phase: 240-connecttruth-validating-a-key-or-a-csv-gets-a-true-answer-an
slug: connecttruth
status: secured
asvs_level: 2
block_on: high
threats_total: 27
threats_closed: 27
threats_open: 0
audited_at_sha: 0a6611c9a1ffbb3c5b021e37e069e329bb89c5c8
diff_base: b752182dc85ac08825089df31303ccaccb228079
---

# Phase 240 CONNECTTRUTH - Security Audit

Verdict: **SECURED**. Every `mitigate` threat was matched to code at the cited location, not to documentation. Each `accept` threat has a recorded entry (below). `threats_open` is 0. `block_on` was not supplied, so the default `high` was assumed; the verdict does not depend on it, because no threat is open at any severity.

Verification depth is ASVS L2: each mitigation was checked for presence AND for sitting at the correct boundary. Implementation files were read-only. Tests were run as corroboration, not as the evidence.

## Test corroboration (run at the audited SHA)

- Python: `pytest` over the Phase 240 limiter, claim, CSV-tier, anonymous-tier, validate-key, rotate-secret, permanence, date-format, hostile-input and never-raise files: **1380 passed**.
- Vitest: `tenant-claim`, `process-key-client`, `csv-limit-agreement`, `validate-key-permanent-400-parity`, `verify-strategy/route`, `seam-venue-vocabulary.invariant`: **193 + 27 passed**.

## Threat verification

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-240-01 | Denial of service | low | mitigate | CLOSED | `services/csv_validator.py` `_MN_DMY` / `_MN_MDY`: bounded classes (`\d{1,2}`, `[A-Za-z]{3,9}`, `\d{4}`), `re.ASCII`, applied with `fullmatch` in `_read_month_name_cell`, no nested quantifier. Cells over `MAX_DATE_CELL_CHARS` (64) are replaced in `_normalise_date_zones` before `_detect_and_normalize_date_column` runs. `test_csv_hostile_inputs_170_1.py` and `test_csv_never_raises_170_1.py` green. |
| T-240-02 | Tampering (data integrity) | medium | mitigate | CLOSED | `_MONTH_NUMBER` is the module's own English table (no locale `strptime %b`); four-digit year only; `datetime.date(...)` in `_read_month_name_cell` rejects impossible days (`except ValueError` returns None). Two-digit and non-English spellings fail the regex or table lookup and stay rejected (pinned in `test_csv_validator_date_format_2026_05_27.py`). |
| T-240-03 | Information disclosure | low | mitigate | CLOSED | `_month_name_flag_sentence` and `_month_only_flag` emit a fixed example "12 Mar 2024" plus a count `n`; no cell text is interpolated. Pinned by `test_flag_message_carries_no_cell_from_the_file`. |
| T-240-04 | Denial of service | high | mitigate | CLOSED | `routers/process_key.py` decorator stack on `process_key`: per-identity `_process_key_limit_for` bottom (evaluated first), `_process_key_anon_aggregate_limit` middle, `_process_key_ceiling_limit_for` top (last). All three are callable providers (a static string would jump the queue). Order pinned as a literal list read off `limiter._dynamic_route_limits`, plus a hammer test that refused calls spend no shared token (`test_process_key_anon_ip_tier.py`). |
| T-240-05 | Spoofing | medium | mitigate | CLOSED | `services/rate_limit.py` `verify_tenant_claim`: 512-char cap, `hmac.compare_digest` over the HMAC-SHA256 MAC, `exp` enforced, all before `classify_tenant_claim`. `classify_tenant_claim`: the `public:` prefix is reserved; `_ANON_IP_PAYLOAD_RE.fullmatch` (`public:[0-9a-f]{32}`, ASCII) is `anon_ip`, any other `public:` payload returns `anon` (shared bucket), never `tenant`. Unicode-digit, trailing-character and wrong-length rows pinned in `test_tenant_claim_parsing.py`. |
| T-240-06 | Denial of service | medium | mitigate | CLOSED | `_PROCESS_KEY_ANON_AGGREGATE_LIMIT = "200/hour"` keyed by the single `anon_aggregate_key("process_key")`; `exempt_when=_process_key_not_anonymous` exempts only non-anonymous kinds, so every `anon` and `anon_ip` claim spends from it however many pseudonyms exist. Anonymous traffic is still subject to the 500/hour ceiling (the csv exemption does not cover it). |
| T-240-07 | Denial of service | medium | mitigate | CLOSED | `classify_tenant_claim`, `tenant_rate_limit_key`, `tenant_or_platform_key`, `platform_ceiling_key` and `anon_aggregate_key` each wrap in try/except and return a non-empty key (`unverified`, fallback or `PLATFORM_DEGRADED_KEY`). Both predicates `_process_key_not_anonymous` and `_process_key_is_csv_scoped` catch and answer `False` (not exempt), so a fault refuses rather than skips. Fault tests: `test_the_exemption_predicate_refuses_rather_than_skips_on_a_fault`, `test_the_csv_predicate_refuses_rather_than_skips_on_a_fault`. |
| T-240-08 | Information disclosure | low | mitigate | CLOSED | `services/app_error_handlers.py` `rate_limit_exceeded_handler` body carries only the fixed envelope plus `throttle.detail` (the limit string from a literal) and the correlation id; headers carry `Retry-After` only; the log lines carry path, limit, retry-after and correlation id, no key or claim. `_alert_anon_bucket_saturated` logs path and limit only. `test_a_per_ip_refusal_leaks_no_identity_in_body_headers_or_the_handler_log` pins it. Slowapi's own library warning may print the keyed pseudonym; accepted per CONTEXT, not reversible without the secret. |
| T-240-09 | Repudiation (lost signal) | low | mitigate | CLOSED | `_alert_anon_bucket_saturated` fires only when `refusing_key` is `anon_bucket_key("process_key")` or `anon_aggregate_key("process_key")`; the `process_key:anon:<hex>` per-IP key returns early before `_anon_alert_last_at` is touched, so the dedupe dict cannot grow per pseudonym. Message, fingerprint (`["anon-bucket-saturated", "process_key"]`) and tag are fixed literals. Pinned in `test_anon_bucket_alert.py`. |
| T-240-10 | Information disclosure | medium | mitigate | CLOSED | `routers/exchange.py`: every converted arm passes a module constant as `detail` (`AUTH_FAILED_DETAIL`, `MT5_WRONG_SERVER_DETAIL`, `MT5_MASTER_PASSWORD_DETAIL`, `SFOX_DISABLED_DETAIL`, `MT5_DISABLED_DETAIL`); `services/closed_sets.py` is untouched by the diff, so the strings are byte-identical to HEAD. No exception text or venue response is interpolated. Control-character test asserts the token never appears in the response (`test_validate_key_permanent_400.py`). |
| T-240-11 | Tampering (contract drift) | medium | mitigate | CLOSED | Committed fixture `analytics-service/tests/fixtures/validate_key_permanent_400_contract.json`, a pytest driver (`test_validate_key_permanent_400.py`) and a zero-mock vitest reader (`tests/lib/validate-key-permanent-400-parity.test.ts`) that asserts the HEAD-shape verdict equals the coded verdict. Both pass. |
| T-240-12 | Denial of service | low | mitigate | CLOSED | Every converted raise in `exchange.py` passes `status_code=400` literally and a non-empty constant `detail`, with `VenueTransientHTTPException.__init__` (`services/error_contract.py`) guarding 4xx range, non-empty detail, non-empty code and bool recoverable. |
| T-240-13 | Elevation of privilege | high | mitigate | CLOSED | The csv scope is read only from `verify_tenant_claim`'s verified payload (`compare_digest`, 300 s `exp`, key `INTERNAL_API_TOKEN`); `_CSV_PAYLOAD_RE.fullmatch` requires `csv:` plus a canonical lowercase 8-4-4-4-12 uuid, ASCII. `_process_key_is_csv_scoped` is `classify_tenant_claim(request).kind == "csv"`; a malformed `csv:` payload is `tenant`, hence not exempt; an unsigned, forged or expired claim is `unverified`, hence not exempt. The exemption is on the ceiling decorator only (not on the identity limit); the csv bucket keeps its own 60/minute limit via `_process_key_limit_for`. Nothing reads the scope from `X-User-Id` or the body. Token-holder trust bound is the claim's documented G-15 model. Pinned in `test_process_key_csv_tier.py` and `test_tenant_claim_parsing.py`. |
| T-240-14 | Denial of service | medium | mitigate-by-accept | CLOSED (accepted risk) | Accepted risk AR-1 below. Bounds verified in code: edge `csvValidateLimiter` 20 per 60 s per user (`src/lib/ratelimit.ts`), `withAuth`, per-user `_PROCESS_KEY_CSV_LIMIT = "60/minute"`. `_PROCESS_KEY_CEILING_LIMIT` docblock records the lost aggregate backstop. |
| T-240-15 | Denial of service | medium | mitigate | CLOSED | `_process_key_is_csv_scoped` never raises and defaults not-exempt (see T-240-07); fault test pinned. |
| T-240-16 | Elevation of privilege (go-dark bypass) | medium | mitigate | CLOSED | `routers/internal.py` `rotate_key_secret`: `if not mt5_enabled_server(): raise VenueTransientHTTPException(... VENUE_DISABLED ...)` is placed after the token, rate-limit, 404 and 422 arms and BEFORE `get_kek()`, `decrypt_credentials` and `_validate_mt5_key`. `test_mt5_rotate_secret_internal.py` spies assert `get_kek`, `decrypt_credentials`, `_validate_mt5_key` and `encrypt_credentials` never run across four disabled values, and the new secret is absent from the response. |
| T-240-17 | Information disclosure | low | mitigate | CLOSED | `create_exchange` (`services/exchange.py`) raises only `ValueError(f"Unsupported exchange: {exchange_name}")`, the caller's own venue name; `validate_key` uses `str(e) or _INVALID_REQUEST_FALLBACK_DETAIL`. The `except Exception` arm still logs rather than returning exception text. The S-11 internal path is untouched by the diff. |
| T-240-18 | Tampering (contract drift) | medium | mitigate | CLOSED | `src/lib/seam-venue-vocabulary.invariant.test.ts` (27 tests, roster and floor) and the parity test were updated in the same change as the raise sites. Both pass. |
| T-240-19 | Denial of service | low | mitigate | CLOSED | `_INVALID_REQUEST_FALLBACK_DETAIL = "Unsupported exchange."` in `exchange.py`, used in the `except ValueError` arm; pinned by the bare-ValueError test. |
| T-240-20 | Information disclosure | medium | mitigate | CLOSED | `src/lib/tenant-claim.ts` `anonymousClaimPayload`: only `public:<first 32 hex of HMAC-SHA256(secret, "anon-ip:" + ip)>` leaves the function; unknown, empty, whitespace or non-string IP returns bare `public`. `src/lib/process-key-client.ts`: `clientIp` is read only at the one `claimPayload` expression; headers are `Content-Type`, `Authorization`, `X-Correlation-Id`, `X-User-Id: args.userId` (stays `public`) and `X-Tenant-Claim`; the one console call in the mint arm logs `scrubSeamError(err)`, never args. `verify-strategy/route.ts` passes `ip` only as `clientIp`; the only other use is the pre-existing Upstash key. No IP header is forwarded. `process-key-client.test.ts:695` asserts the raw IP is absent from every header, the body and every console call. |
| T-240-21 | Spoofing | medium | mitigate | CLOSED | `getClientIp` (`src/lib/ratelimit.ts`) is unchanged and trusts `x-real-ip` only when `VERCEL === "1"`, else the rightmost XFF entry; Python's 200/hour aggregate bounds the total (T-240-06). |
| T-240-22 | Information disclosure | low | accept | CLOSED (accepted risk) | Accepted risk AR-2 below; recorded in the `anonymousClaimPayload` docblock ("Pseudonymous, not anonymous: Python holds the same key (T-240-22, accepted)"). |
| T-240-23 | Tampering | medium | mitigate | CLOSED | `postProcessKey` builds the payload in the one chokepoint: `userId === "public"` takes the anonymous branch, else `args.flow_type === "csv"` takes `csv:<userId>`, else the plain id; `flow_type` is the closed `FlowType` union. `process-key-client.test.ts:781` pins that only csv carries the prefix and the other flows never start with `csv:`. |
| T-240-24 | Denial of service | low | mitigate | CLOSED | `src/lib/ratelimit.ts` `csvFinalizeLimiter = makeLimiter(20, "60 s")`; `csv-finalize/route.ts` calls `checkLimit(csvFinalizeLimiter, "strategies-csv-finalize:${user.id}")` at its unchanged position (diff touches only the import and the limiter name); the per-user key is kept. |
| T-240-25 | Tampering (config drift) | medium | mitigate | CLOSED | `tests/lib/csv-limit-agreement.test.ts` reads both the edge and upstream numbers (3x relationship) and passes. |
| T-240-26 | Repudiation (contradictory verdicts) | low | mitigate | CLOSED | `routers/process_key.py`: the synchronous gate skips the 424 arm when `val.permanent is True` and answers `recoverable=False`; `_run_validate_only` passes `recoverable=False if val.permanent is True else None`; the True-only choice is recorded in the pre-gate comment and in `services/ingestion/adapter.py`. A stated False keeps the code-derived verdict. Pinned by `test_process_key_permanence_plumbing.py`. |
| T-240-27 | Tampering (doc drift) | low | mitigate | CLOSED | `analytics-service/docs/STATUS_CONTRACT.md`: 0 `file.py:NNN` coordinates outside the historical section 7 S-table (checked by line range). |
| T-240-SC (x8) | Tampering (supply chain) | low | accept | CLOSED (accepted risk) | AR-3 below. The diff touches no `package.json`, lockfile or `requirements*.txt`; no package was installed. |

## Specific audit points requested

- **Signed claim grammar and HMAC domain separation.** The per-IP digest message is `anon-ip:<ip>`, while a claim MAC's message is `<payload>.<exp>` with payload a server-derived uuid, `public`, or `csv:<uuid>`. A claim MAC message therefore never begins `anon-ip:`, so the pseudonym cannot be replayed as a MAC and a MAC cannot be reused as a pseudonym. Python never recomputes the pseudonym; it only fullmatches the 32 hex. The fixture `tests/fixtures/tenant-claim-parity.json` pins the derivation for both languages.
- **Raw IP never in a header, log or 429 body.** Confirmed at T-240-20 and T-240-08. No `get_remote_address` use remains in any non-test analytics module (matches are comments only; pinned by `test_limiter_identity.py`).
- **Limiter stack order and fail-closed exemptions.** Confirmed at T-240-04 and T-240-07. Order is identity, then aggregate, then ceiling. The aggregate exemption defaults to not-exempt on a fault (a tenant would then be counted, which refuses rather than skips); the ceiling exemption defaults to not-exempt.
- **Single-limit routes (fix `fe8515052`).** `tenant_or_platform_key` maps both `anon` and `anon_ip` to `anon_bucket_key(scope)`, so N pseudonyms cannot buy N windows on routes with no aggregate above them. Pinned at `test_tenant_claim_parsing.py` (the "anonymous claim on those routes must fold into the shared bucket" row).
- **CSV ceiling exemption accepts only a signed `csv:<uuid>`.** Confirmed at T-240-13.
- **Rotate-secret go-dark gate before the KEK load.** Confirmed at T-240-16.
- **Detail strings byte-identical, no internals leaked in the new 400 bodies.** Confirmed at T-240-10 and T-240-17. The one non-constant detail is the caller's own venue name in `Unsupported exchange: <name>` (see Observation O-1).

## Accepted risks log

| ID | Threat | Risk accepted | Basis |
|----|--------|---------------|-------|
| AR-1 | T-240-14 | CSV traffic is exempt from the 500/hour platform ceiling, so the ceiling no longer backstops CSV traffic in aggregate. Bounded by the 20 per 60 s per-user edge limit, authentication, body and row caps and the per-user 60/minute csv tier. | Founder ruling 2026-11-24 (CONTEXT RLIM-02: "never refused upstream"). Recorded in the `_PROCESS_KEY_CEILING_LIMIT` docblock. **Pending at ship:** the plan requires the CHANGELOG entry to state it; the CHANGELOG is written at ship and was not checked here. |
| AR-2 | T-240-22 | The per-IP pseudonym is keyed with `INTERNAL_API_TOKEN`, which Python also holds, so it is pseudonymous not anonymous. Slowapi's own warning line may print the keyed pseudonym. | CONTEXT discretion resolution and RESEARCH Open Question 1. Recorded in the `anonymousClaimPayload` docblock. |
| AR-3 | T-240-SC | No package installed in any plan. | Diff shows no dependency manifest change. |

## Observations (not threats, not blocking, no register entry)

- **O-1.** `INVALID_REQUEST` echoes the caller-supplied `exchange` string via `str(e)`. This is unchanged from HEAD (the prior arm already returned `str(e)`); the 400 body shape widened, the disclosed content did not. It is the caller's own input, so there is no cross-user leak.
- **O-2.** The `csv:` arm in `tenant_or_platform_key` handles a state no current route reaches (review INFO). If a future route minted `csv:` claims onto a single-limit route, it would hand a user a second window with no aggregate above it. Latent only.
- **O-3.** `_process_key_not_anonymous` and `_process_key_is_csv_scoped` have `except` arms that are effectively unreachable because `classify_tenant_claim` never raises (review SFH-L1). Defence in depth, harmless.

## Unregistered flags

None. All eight SUMMARY `## Threat Flags` sections report "None" or restate a registered threat ID.
