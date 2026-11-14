---
phase: "211"
slug: "syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the"
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-14"
---

# Phase 211 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

The register was written at plan time, ASVS is 1, and no threat at or above the block threshold (`high`) is open, so the workflow skipped the auditor (L1 grep depth is enough). The evidence below comes from the round-1 and round-2 code reviews, the silent-failure-hunter, migration-reviewer (twice), rls-policy-auditor and the verifier, all recorded in `211-REVIEW.md` and `211-VERIFICATION.md`.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| enqueue RPC → `_enqueue_compute_job_internal` | Service-role and user SECDEF RPCs pass caller metadata into the enqueue | Request ids (correlation, verification, contact request); no credentials |
| `_record_enqueue_dedup` → `compute_job_dedup_events` | SECDEF helper writes caller metadata to a deny-all side table | Same request ids, capped at 8192 bytes |
| analytics worker → exchange APIs | Trade fetch reach is chosen from the stored high-water | Exchange trade history (tenant-scoped) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-211-01 | Tampering | `fetch_trades` seed | high | mitigate | Seed from `load_strategy_high_waters` (`routers/exchange.py`); verifier neuter turned 3/4 tests RED | closed |
| T-211-02 | Denial of service | full reach on failed high-water read | low | accept | LASTSYNC-SEED decision 3; route rate-limited | closed |
| T-211-03 | Information disclosure | helper `logger.exception` | low | accept | Same fields as before the move | closed |
| T-211-04 | Tampering | `_stamp_failed` oracle | medium | mitigate | `_entry_computation_status` snapshot (`job_worker.py`); verifier neuter turned F2 tests RED | closed |
| T-211-05 | Denial of service | entry read failing | low | mitigate | Raises `RefreshMarkerRereadUnavailable` before any write; `TestCompositeEntryReadFailure` | closed |
| T-211-06 | Elevation of privilege | CREATE OR REPLACE of overloads + helper | high | mitigate | REVOKE/GRANT restated, verify block asserts ACLs; migration-reviewer and rls-policy-auditor clean | closed |
| T-211-07 | Tampering | search-path hijack | high | mitigate | `SET search_path = public, pg_catalog`, schema-qualified calls; verify asserts `proconfig` | closed |
| T-211-08 | Tampering | caller metadata driving retraction | high | mitigate | Retract-only, kind-scoped, parented and `done_pending_children` skipped; gate arms KIND-*, PARENTED, DPC-SKIP, MARKED-CALLER; D11-5 census re-checked by verifier and rls-policy-auditor | closed |
| T-211-09 | Information disclosure | side table holds caller metadata | medium | mitigate | RLS enabled, deny-all policy, service_role SELECT only; TABLE arm; rls-policy-auditor found no tenant leak | closed |
| T-211-10 | Denial of service | side-table growth / oversized payload | medium | mitigate | FK cascade, NULL/`{}` skipped, `oversize_bytes` cap; OVERSIZE and EMPTY-META arms | closed |
| T-211-11 | Denial of service | enqueue failing on PROD | high | mitigate | Gate on throwaway lane 16/16 biting; WR-01 lock fix (no FK KEY SHARE on fan-in children); rollback restores both bodies | closed |
| T-211-12 | Tampering | `run_sync_trades_job` seed | high | mitigate | `daily_since_ms` from stored high-water; verifier neuter turned 3/3 tests RED | closed |
| T-211-13 | Denial of service | full reach on failed read | low | accept | LASTSYNC-SEED decision 3; per-kind timeout | closed |
| T-211-14 | Repudiation | gate arms | high | mitigate | Every arm twinned; mutation runner 16/16 biting, WAIVED_CEILING 0 | closed |
| T-211-15 | Tampering | lane cross-run interference | low | mitigate | Own seeds, `BEGIN ... ROLLBACK`, throwaway schema | closed |
| T-211-16 | Repudiation | census floors | medium | mitigate | Floors measured (ARMS_FLOOR 846, FILES_FLOOR 82); census vitest files pass | closed |
| T-211-17 | Tampering | marker-set drift Python/TS | medium | mitigate | Parity tests in Python and TS over the snapshot | closed |
| T-211-18 | Repudiation | stale D-02 comments | low | mitigate | Plan 07 rewrites, dated and cited | closed |
| T-211-SC | Tampering | package installs | low | accept | No package installed | closed |

*Status: open · closed · open — below high threshold (non-blocking)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-211-01 | T-211-02, T-211-13 | Over-fetch on a failed read is idempotent and bounded (LASTSYNC-SEED decision 3) | founder decision, recorded in 211-CONTEXT.md | 2026-11-14 |
| AR-211-02 | T-211-03 | Log carries strategy id and exception text only, as before | plan 01 | 2026-11-14 |
| AR-211-03 | T-211-SC | No dependency added | plans 01-07 | 2026-11-14 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-14 | 19 | 19 | 0 | gsd-secure-phase (L1 short-circuit), evidence from review, migration and RLS audits |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
