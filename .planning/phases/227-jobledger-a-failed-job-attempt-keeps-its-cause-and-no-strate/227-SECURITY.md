---
phase: "227"
slug: "jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate"
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-24"
---

# Phase 227 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Verified by gsd-security-auditor at ASVS L1 (presence of each mitigation and its named gate arm at the cited line; the auditor ran no tests). Line numbers are as of the round-3 review head (`19e506b61`); cite by symbol if they drift.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| PostgREST API roles to new tables | anon / authenticated must never reach the attempt ledger, readmit exhaustions or first-hop retries | worker error text (may quote a broker account) |
| service_role worker to SECDEF RPCs | worker records attempt errors and renews claims through token-fenced SECDEF functions | job ids, claim tokens, error text |
| pg_cron owner to first-hop sweep | owner-only sweep writes a fixed user-visible sentence into `strategy_analytics` | strategy ids, a constant message |
| Worker to Sentry / ops_alert | page detail and fence-failure events leave the database | strategy uuid, counts, exception class only |
| Account erasure (`sanitize_user`) and GDPR export | the ledger must be erased and exported with its data subject | error text keyed by owner |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-227-01 | Information disclosure | `compute_job_attempt_failures` ACL | high | mitigate | RLS on, no policy, REVOKE ALL, service_role SELECT only (0000:195-202); STEP 5 catalogue check; gate arm E8 | closed |
| T-227-02 | Tampering | `record_compute_job_attempt_error` | medium | mitigate | service_role only; token attested by running row or a watchdog_reset / stall_reclaim / orphan_reaped row; arm E4 | closed |
| T-227-03 | Repudiation | `mark_compute_job_failed` | medium | mitigate | ledger INSERT in the same transaction after the status UPDATE; UNIQUE (job_id, claim_token, cause_class) | closed |
| T-227-04 | Information disclosure | ledger lifecycle | medium | mitigate | four owner FKs ON DELETE CASCADE, asserted in STEP 5; no FK to compute_jobs (retention: R-01) | closed |
| T-227-05 | Denial of service | watchdog bridge loop | medium | mitigate | LIMIT 500 + SKIP LOCKED, sorted advisory locks; 500 rows in 1117 ms on the pg-lane | closed |
| T-227-06 | Tampering | `strategy_analytics` via bridge | medium | mitigate | only `sync_strategy_analytics_status`; arm B2 | closed |
| T-227-07 | Elevation of privilege | re-based watchdog SECDEF | medium | mitigate | REVOKE restated, search_path pinned, self-verify | closed |
| T-227-08 | Tampering | `renew_compute_job_claims` | medium | mitigate | renews only on matching token and status running; arm R2 | closed |
| T-227-09 | Denial of service | heartbeat renew | medium | mitigate | renews waiting jobs only, throttled and time-bounded, cancelled in finally; pytest | closed |
| T-227-10 | Elevation of privilege | renew SECDEF | medium | mitigate | pinned search_path, service_role only; arm R5 | closed |
| T-227-11 | Information disclosure | `reconcile_readmit_exhaustions` | low | mitigate | RLS on, service_role SELECT only; arm X7 | closed |
| T-227-12 | Tampering | `paged_at` / `marker_count` | medium | mitigate | column grant UPDATE (paged_at) only; arm X7 asserts 42501 | closed |
| T-227-13 | Denial of service | readmit detector | low | mitigate | LIMIT 100, no row locks, 300 s cadence | closed |
| T-227-14 | Elevation of privilege | `first_hop_enqueue_sweep` | high | mitigate | SECDEF, REVOKE from all API roles incl. service_role, owner-only EXECUTE asserted; arm H14 | closed |
| T-227-15 | Tampering | user-visible `computation_error` | medium | mitigate | constant sentence, overwrites only a pending row; arm H4 | closed |
| T-227-16 | Denial of service | re-enqueue loop | medium | mitigate | once-only re-enqueue guard, LIMIT 25; arms H6, H6b | closed |
| T-227-17 | Information disclosure | sweep acting on revoked key | medium | mitigate | requires active, connected key; arms H11, H12 | closed |
| T-227-18 | Information disclosure | poll on revoked key | high | mitigate | live-key conjunct in cohort; arm P3 + twin | closed |
| T-227-19 | Denial of service | wider daily poll fan-out | low | mitigate | daily idempotency key; PROD cohort measured 1 to 7 | closed |
| T-227-20 | Elevation of privilege | re-based poll SECDEF | medium | mitigate | pinned search_path, REVOKE restated | closed |
| T-227-21 | Denial of service | orphan trigger on hot table | low | mitigate | narrow `AFTER UPDATE OF status ... WHEN` | closed |
| T-227-22 | Elevation of privilege | trigger function | low | mitigate | pinned search_path, REVOKE from all roles; arm O4 | closed |
| T-227-23 | Denial of service | pre-dispatch claim fence | high | mitigate | missing RPC by structured code dispatches as before; other errors skip one job; bounded by wait_for; loud Sentry event per tick; pytest | closed |
| T-227-24 | Tampering | run-twice of reclaimed job | high | mitigate | job missing from renewed set is skipped before dispatch; pytest + arm R2 | closed |
| T-227-25 | Information disclosure | error text to ledger / Sentry | low | mitigate | service_role-only ledger; Sentry events carry ids or exception class only; `send_default_pii=False` | closed |
| T-227-26 | Information disclosure | page detail and cause | low | mitigate | detail from counts and timestamps only; `scrub_alert_detail` | closed |
| T-227-27 | Denial of service | alert storm | low | mitigate | 300 s interval, batch 25, stop at first undelivered, 3600 s per-key window | closed |
| T-227-28 | Repudiation | undelivered page read as sent | medium | mitigate | `paged_at` stamped only after confirmed delivery; pytest | closed |
| T-227-29 | Tampering | accidental PROD write while proving schema | high | mitigate | no db push / reset / db-url in the diff; proofs ran on the loopback pg-lane; the local-stack `--assert-local-handoff` leg is owed to CI (Docker unavailable locally) | closed |
| T-227-30 | Repudiation | census moved by arithmetic | medium | mitigate | floors pasted from runs; WAIVED_CEILING 0; full mutation run 990/990 exit 0 | closed |
| T-227-31 | Information disclosure | runbook and SUMMARY text | medium | mitigate | scan found no home path, email or PROD ref | closed |
| T-227-32 | Tampering | migration scheduling a job at merge | high | mitigate | zero cron.schedule in all 8 migrations; `jobledger-migrations-schedule-nothing.test.ts` with RED proof | closed |
| T-227-33 | Repudiation | HEAL-01 delivery record | medium | mitigate | REQUIREMENTS Traceability reads Blocked (PROD go-live pending); checkbox unticked | closed |
| T-227-SC | Tampering | supply chain | low | accept | no dependency manifest or lockfile in the phase diff | closed |
| WR-02 | Information disclosure | ledger owner cascades (review round 1) | medium | mitigate | portfolio_id and allocator_id cascades; all 7 writers copy owner columns; arms E9, E9b, E9c | closed |
| GDPR-ERASE | Information disclosure | `sanitize_user` purge (review, 20261124120700) | high | mitigate | DELETE by all four owner keys before the api_keys delete; re-based on 20260827130000; arms E11 to E11d run the real `sanitize_user` | closed |
| GDPR-EXPORT | Information disclosure | Art. 15 export entry | medium | mitigate | direct manifest entry on allocator_id, scoped by `.eq(user_column, userId)` (scope: R-02) | closed |
| R-01 | Data retention | ledger has no retention window | low | open | no purge cron; rows leave on owner deletion or `sanitize_user`; set a window together with Phase 230, which reads these rows | open — below high threshold (non-blocking) |
| R-02 | Information disclosure | export scope | low | open | strategy- and api-key-keyed rows are erased but not exported, the same posture as `compute_jobs`; needs an explicit accept or a parent-keyed export entry | open — below high threshold (non-blocking) |
| R-03 | Data retention | erasure race | low | open | an attempt in flight at erasure can write one new ledger row after the `sanitize_user` DELETE | open — below high threshold (non-blocking) |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

Unregistered flag (informational): `227-01-SUMMARY.md` `lock-surface`. The ledger INSERT in `mark_compute_job_failed` takes FK key-share locks while the job row is held FOR UPDATE, in the same order as the other fan-in paths. Three review rounds raised no defect.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-227-01 | T-227-SC | The phase installs no package; the dependency-manifest diff is empty | phase agent (standing repo posture) | 2026-11-24 |

R-01 to R-03 are NOT accepted here. They are low, open and non-blocking, and are surfaced to the founder for a decision: accept, or schedule with Phase 230.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-24 | 40 | 37 | 3 (low, non-blocking) | gsd-security-auditor (sonnet), ASVS L1 |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
