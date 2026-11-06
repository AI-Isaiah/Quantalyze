---
phase: "160"
slug: "provenance"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-10-03"
---

# Phase 160 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Written retroactively on 2026-10-03 (close-out audit). The register is built from the 7 PLAN
> `<threat_model>` blocks (31 rows, one per plan and id; plans 06 and 07 reuse ids T-160-24..27 for
> different threats, so rows are keyed by id and plan). Audited by gsd-security-auditor at
> `origin/main` `2068c4fa1`.

---

## Trust Boundaries

| Boundary | Description | Plan |
|----------|-------------|------|
| orchestrator → PROD DB | read-only SQL (census, soak re-measure, smoke row checks) | 01, 05 |
| `.planning` artifacts → public repo | census, parity and smoke evidence are world-readable | 01, 06, 07 |
| browser → `/api/keys/validate-and-encrypt` | untrusted body: venue, raw credentials, label, persist flag | 02, 03 |
| route → PROD `api_keys` (service_role) | privileged write path; the trust ceiling | 02 |
| route → Python `/validate-key`, `/encrypt-key` | seam carrying raw key material | 02 |
| browser (authenticated) → `api_keys` | the INSERT verb being withdrawn; SELECT and DELETE remain | 03, 05 |
| CI sql-tests → test DB | where the gate executes | 03 |
| `api_keys.exchange` → money-math stamp | the forgeable input removed from the stamp path | 04 |
| `strategies.asset_class` → analytics worker | the annualization clock, trusted downstream | 04 |
| main merge → PROD Postgres | migrations auto-apply: the merge is the apply | 05 |
| stale browser JS → route + `api_keys` | the skew window | 05 |
| fix author → phase record | self-certification gap | 07 |
| PROD browser → persist arm | first real exercise of the server writer | 07 |

---

## Threat Register

| Threat ID (plan) | Category | Severity | Disposition | Evidence | Status |
|-----------|----------|----------|-------------|----------|--------|
| T-160-01 (01) | Information Disclosure | high | mitigate | `160-CENSUS.md` "no PII, ever"; email-shape grep 0 hits | closed |
| T-160-02 (01) | Tampering | critical | mitigate | no write/DDL statement in any census SQL block; 0 `RESULTS: PENDING` | closed |
| T-160-03 (01) | Repudiation | high | mitigate | census-completion preconditions in plans 02/04; guard re-pins from the census (`20260823120000_revoke_api_keys_insert.sql`) | closed |
| T-160-04 (02) | Tampering | critical | mitigate | `validate-and-encrypt/route.ts` normalizes the venue once and writes both columns from it; CHECK backstop and scrub trigger; route tests | closed |
| T-160-05 (02) | Spoofing | critical | mitigate | `user_id` from the withAuth session only; body and upstream uid ignored (tests) | closed |
| T-160-06 (02) | Tampering | high | mitigate | strict `body.persist !== true` → STALE_CLIENT; string "true" refused (tests) | closed |
| T-160-07 (02) | Elevation of Privilege | high | accept | service-role trust ceiling, stated in code and in the `attested_venue` column comment | closed (accepted) |
| T-160-08 (02) | Information Disclosure | high | mitigate | success body `{api_key_id, valid, read_only}`; per-request secret redaction at every sink (tests) | closed |
| T-160-09 (02) | Denial of Service | medium | mitigate | limiter on the persist arm (test); STALE_CLIENT does no upstream work | closed |
| T-160-10 (03) | Tampering | critical | mitigate | no client `api_keys` insert/upsert in `src/`; StrategyForm, ApiKeyManager, AllocatorExchangeManager POST `persist: true` | closed |
| T-160-11 (03) | Tampering | high | mitigate | service_role retention positive runs unconditionally in `test_api_keys_insert_not_client_writable.sql` | closed |
| T-160-12 (03) | Denial of Service | high | mitigate | AllocatorExchangeManager on the persist arm; PROD smoke 2026-10-02 | closed |
| T-160-13 (03) | Denial of Service | medium | mitigate | state-adaptive marker gate emits a loud SKIP notice | closed |
| T-160-14 (04) | Tampering | critical | mitigate | `finalize-wizard/route.ts` stamps `asset_class` from the attested venue | closed |
| T-160-15 (04) | Tampering | critical | mitigate | NULL-attestation guard `skipAssetClassWrite`; test; neuter RED recorded | closed |
| T-160-16 (04) | Repudiation | high | mitigate | literal fixtures with attested ≠ exchange; neuter bite recorded | closed |
| T-160-17 (04) | Information Disclosure | low | accept | no new response fields; skip log carries venue strings only | closed (accepted) |
| T-160-18 (05) | Denial of Service | critical | mitigate | deploy-before-migration held (PR-1 deployed before #704); gate amended to specialist-review by the founder | closed |
| T-160-19 (05) | Tampering | high | mitigate | hand-typed pins, abort-on-drift, refuse-to-guess on an unidentified DB | closed |
| T-160-20 (05) | Denial of Service | high | mitigate | whole-repo re-grep: zero browser INSERTs (re-measured at the audited sha) | closed |
| T-160-21 (05) | Information Disclosure | high | mitigate | legacy arm retired (STALE_CLIENT; tests). Same-deploy clause was violated; the window was closed by the PROD 409 measurement (T-160-26 (07)) | closed |
| T-160-22 (05) | Tampering | high | mitigate | no INSERT grant to anon/authenticated on `api_keys`; no later re-grant | closed |
| T-160-23 (05) | Elevation of Privilege | high | mitigate | the REVOKE migration carries no CREATE/FUNCTION/GRANT DDL; aborting post-verifies | closed |
| T-160-24 (06) | Tampering | critical | mitigate | zero parity candidates → zero writes (`160-PARITY.md`, census Q2 = 0) | closed |
| T-160-25 (06) | Repudiation | high | mitigate | `160-PARITY.md` committed as a recorded no-op citing the census | closed |
| T-160-26 (06) | Information Disclosure | high | mitigate | `160-PARITY.md` email-shape grep 0 hits; ids, counts, metrics only | closed |
| T-160-27 (06) | Tampering | high | mitigate | `venue_derived` from the census CASE; delta direction pinned; no stamp moved | closed |
| T-160-24 (07) | Repudiation | high | mitigate | independent re-verification recorded; score not re-cut by the orchestrator | closed |
| T-160-25 (07) | Denial of Service | critical | mitigate | persist arm proven on PROD via ApiKeyManager and AllocatorExchangeManager; StrategyForm kept open as behavior-unverified (founder override) | closed |
| T-160-26 (07) | Information Disclosure | high | mitigate | PROD 409 STALE_CLIENT measured after deploy, body `{code,error}`, no ciphertext | closed |
| T-160-27 (07) | Information Disclosure | high | mitigate | plan 07 files carry no email-shaped token (one pre-existing TODOS hit predates phase 160) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-160-01 | T-160-07 (02) | Any server route holding the service-role client can still write any uid and venue (ADR-0001/0003 trust ceiling). The phase narrows "any browser can forge an attestation" to "only our server code can", and never claims more. | plan 02 threat model, confirmed by audit | 2026-10-03 |
| AR-160-02 | T-160-17 (04) | low severity; no new response surface; the skip log repeats venue strings already in the row | plan 04 threat model, confirmed by audit | 2026-10-03 |

---

## Audit notes

- **Unregistered flag, fixed in the same commit:** `160-UAT.md` carried a smoke account's email-shaped identifier (reserved `.test` TLD) in public smoke evidence. It is replaced by "the smoke account".
- **Out of scope, surfaced:** the baseline grants show `anon` and `authenticated` holding TRUNCATE on `api_keys`. Not a declared threat of this phase and not assessed here; routed to the founder for a decision.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-03 | 31 | 31 (29 mitigated, 2 accepted) | 0 | gsd-security-auditor at `2068c4fa1` (SECURED), retroactive close-out |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-03
