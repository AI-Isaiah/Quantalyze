---
phase: "177"
slug: "deribitflows-deribit-flow-instants-are-valued-at-the-mark-da"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-10-28"
---

# Phase 177 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Deribit public market data → analytics worker | `get_tradingview_chart_data` 1-minute `{CCY}_USDC-PERPETUAL` candles, unauthenticated | Untrusted numbers (ticks, opens) that become money-math input |
| Analytics worker → `public.api_key_flow_prices` | Service-role PostgREST read/write of resolved prices | Per-key flow minutes (timing of a user's deposits and withdrawals) and public prices |
| Browser roles (anon / authenticated) → `public.api_key_flow_prices` | No grant, RLS forced, zero policies | None (refused 42501) |
| Worker logs → Sentry / Railway logs | Counts-only D-01 lines, reason tokens, scrubbed exception text | No key ids, no amounts |

---

## Threat Register

Evidence for every row is in the auditor's verdict (2026-10-28, HEAD 8e25f31e9); file references below are repo-relative.

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-177-01 | Tampering | minute reader parse | high | mitigate | bool/overflow/non-finite/non-positive ticks raise; malformed 200 retried (`deribit_ingest.py`) | closed |
| T-177-02 | Tampering | key-mode apply seam | high | mitigate | `_deribit_moved_flow_gate` on final marks before `at_instant_index` is wired; no own-day fallback | closed |
| T-177-03 | DoS | prefetch | medium | mitigate | `wait_for` bounded by remaining budget minus reserve; bounded retries; one read per (ccy, day) | closed |
| T-177-04 | DoS | Deribit rate limit | medium | mitigate | reads only unstored moved minutes; last-attempt `RateLimitExceeded`/`DDoSProtection` re-raised | closed |
| T-177-05 | Information disclosure | log lines / error text | medium | mitigate | `scrub_freeform_string`; tokens and counts only | closed |
| T-177-06 | Tampering | table grants | high | mitigate | REVOKE ALL then GRANT SELECT, INSERT to service_role; gate arms 4, 5a, 5b | closed |
| T-177-07 | Information disclosure | cross-user flow timing | high | mitigate | RLS enabled and forced, zero policies, no browser grants; gate arms 1, 8 | closed |
| T-177-08 | Repudiation | erasure | high | mitigate | `ON DELETE CASCADE` from `api_keys`; gate arm 6 (key and account paths) | closed |
| T-177-09 | Tampering | stored value rules | high | mitigate | four named CHECKs; gate arms 7a–7e | closed |
| T-177-10 | DoS | data-dependent migration | medium | mitigate | catalogue-only verify block; data-dependence lint 0 NEW | closed |
| T-177-11 | Tampering | write-once / index authority | high | mitigate | upsert `ignore_duplicates` then re-select; index from stored rows | closed |
| T-177-12 | Tampering | store parse | high | mitigate | strict `_parse_stored`, raises, never skips | closed |
| T-177-13 | DoS | `max_rows` truncation | medium | mitigate | 100-key chunks; over-size response raises | closed |
| T-177-14 | Information disclosure | `FlowPriceStoreError` text | medium | mitigate | static text, chained cause | closed |
| T-177-15 | Elevation of privilege | live probe | medium | mitigate | loopback-lane guard before each write; own rows deleted | closed |
| T-177-16 | Tampering | prediction miss | high | mitigate | `missing > 0` → transient `prediction_miss` at all three seams | closed |
| T-177-17 | Tampering | structural no-data minute | high | mitigate | permanent `mark_flow_index_unavailable`, nothing written | closed |
| T-177-18 | DoS | mark lost to read failure | medium | mitigate | failures captured, surfaced after the mark write | closed |
| T-177-19 | DoS | 429 storm | medium | mitigate | `_stamp_429` once | closed |
| T-177-20 | Information disclosure | capture warning | low | mitigate | reason token and class name only | closed |
| T-177-21 | Tampering | strategy / allocated seams | high | mitigate | `at_instant_index` passed, each after the gate | closed |
| T-177-22 | Information disclosure | D-01 log line | medium | mitigate | counts and mode only, no ids | closed |
| T-177-23 | Tampering | composite members | high | mitigate | `_member_moved_flow_index` with exact marks | closed |
| T-177-24 | Tampering | no-data member minute | high | mitigate | `_MemberFlowIndexUnavailable` permanent refusal | closed |
| T-177-25 | DoS | member 429 | medium | mitigate | propagates to existing `_stamp_429` arms | closed |
| T-177-26 | Information disclosure | composite D-01 line | low | mitigate | `seq` and counts only | closed |
| T-177-27 | Tampering | gate removed / neutered | high | mitigate | mutation floors ratcheted; `WAIVED_CEILING` 0 | closed |
| T-177-28 | Information disclosure | GDPR coverage drift | medium | mitigate | no user column; cascade erasure; coverage script unchanged | closed |
| T-177-29 | Elevation of privilege | hand-added browser type | low | accept | see Accepted Risks Log | closed |
| T-177-30 | DoS | prefetch outruns 900 s budget | medium | mitigate | remaining-budget bound, 10 s floor, timeout captured | closed |
| T-177-31 | Tampering | coverage check dropped at one seam | high | mitigate | one shared gate at three seams; per-seam RED drills | closed |
| T-177-32 | DoS | member transient filed permanent | medium | mitigate | permanent tuple lists only refusal classes | closed |
| T-177-SC | Tampering | package installs | high | accept / mitigate | see Accepted Risks Log; manifest diff empty | closed |

*Status: open · closed · open — below high threshold (non-blocking)*

Non-blocking review observations (not registered threats, below `block_on: high`): IN-12 (INFO, a transport-fault warning can show a flow's minute in the URL), IN-13 (LOW, the 10 s store-read bound below the floor is charged to the post-crawl reserve), IN-14 (LOW, a code bug in the transient bucket is a WARNING not a Sentry event), IN-01 (LOW), IN-04 (LOW). See 177-REVIEW.md.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-177-01 | T-177-29 | `src/lib/database.types.ts` carries a hand-added type for a service-role-only table; any browser query is refused by the privilege model (gate arm 1) | plan 07 disposition, verified by gsd-security-auditor | 2026-10-28 |
| AR-177-02 | T-177-SC | Plans 01–06 added no package; the manifest and lockfile diff is empty | plan disposition, verified by gsd-security-auditor | 2026-10-28 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-28 | 33 | 33 | 0 | gsd-security-auditor (Sonnet) at 8e25f31e9; migration-reviewer CLEAN; rls-policy-auditor CLEAN |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-28
