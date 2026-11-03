---
phase: "185"
slug: "deribitflowtime"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on (high) severity
threats_open: 0
asvs_level: 1
created: "2026-11-03"
---

# Phase 185 - Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (10 PLAN threat models). Verified against the shipped code of #1187 (v0.133.18.0) by gsd-security-auditor, ASVS 1, block_on high.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| orchestrator to PROD analytics worker / PROD database | read-only investigation (plans 01, 02, 03, 10) | decrypted API credentials (never printed), transaction log, SELECT results |
| scratch files to tracked SUMMARY | key letters, dates, counts, ratios only | identifying values stay in scratch |
| worker report to `key_inputs` JSONB | present-only bool and fixed basis name | owner-RLS row |
| Python writer to TS reader | `options_cash_basis` / `options_activity` key literals | pinned by an independent literal test |
| Deribit public chart reads to the derive | bounded by the derive budget | venue data |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-185-01 | Information disclosure | plan 01 output and SUMMARY | high | mitigate | Hygiene greps over the 26 tracked phase files: 0 UUID, 0 home path, 0 key-tag hits; keys A and C only | closed |
| T-185-02 | Tampering | PROD database (plan 01) | critical | mitigate | Scratch script scanned: select-only; script untracked, SUMMARY has no static-scan or marker line (artifact inspection) | closed |
| T-185-03 | Information disclosure | decrypted credentials | high | mitigate | Errors print class name only; raw outputs hold no credential words | closed |
| T-185-04 | Tampering / DoS | backfill worker start command (plan 01, fallback ii) | high | mitigate | Plan requires the service configuration read back and recorded in the SUMMARY. Re-audit 2026-11-03: commit ae58a53f4 appended a dated read-back to `185-01-SUMMARY.md` (lines 72-74): service `quantalyze-analytics-backfill` (production), `startCommand: "python -m main_worker"`, `staged: null`, fallback command gone. It matches the runbook's declared worker command and the `185-02-SUMMARY.md` read-back. The earlier line saying plan 01 did not re-read the configuration stays as lineage. Limits: the read-back is the orchestrator's read-only Railway observation recorded in the SUMMARY, not independently re-read by the auditor, and `railway.toml` carries no `startCommand`, so no repo file attests the live value | closed |
| T-185-05 | Information disclosure | plan 02 output and SUMMARY | high | mitigate | 0 tag, UUID, home-path or instrument-name hits | closed |
| T-185-06 | Tampering | PROD database (plan 02) | critical | mitigate | Select-only script; `marker: PRODUCTION` line and self-test recorded | closed |
| T-185-07 | Information disclosure | decrypted credentials (plan 02) | high | mitigate | Existing decrypt path only; class-name errors; logging disabled | closed |
| T-185-08 | Tampering / DoS | backfill worker start command (plan 02) | high | mitigate | Restore and read-back recorded in `185-02-SUMMARY.md`; script variable deleted and read back | closed |
| T-185-09 | Information disclosure | plan 03 SUMMARY | high | mitigate | Key C, ratios only, 0 UUID or home path | closed |
| T-185-10 | Tampering | PROD database (plan 03) | critical | mitigate | SELECT only with marker first (SUMMARY evidence; MCP SQL not retained) | closed |
| T-185-11 | Tampering | flag key literal | high | mitigate | Independent literal pin test; reader, writer and activity-literal drills all RED | closed |
| T-185-12 | Tampering | truthy coercion | medium | mitigate | `is True` on write, `=== true` on read; `bool()` drill RED | closed |
| T-185-13 | Information disclosure | `key_inputs` payload | low | mitigate | Bool and basis name only; owner-select RLS with FORCE RLS | closed |
| T-185-14 | Information disclosure | `readMarksStart` | medium | mitigate | `.eq("allocator_id", userId)` over RLS; foreign-row test; removal drill RED | closed |
| T-185-15 | Tampering | strict parse | low | mitigate | `isOptionsCashBasis` at reader and builder; `Boolean` swap drill RED | closed |
| T-185-16 | Repudiation | departed keys | low | mitigate | `marks_since` fail-closed rule pinned; removal drill RED | closed |
| T-185-17 | Repudiation | founder answer lines | medium | mitigate | One well-formed answer line per question; plan 08 precondition reads them | closed |
| T-185-18 | Denial of service | second crawl in the derive | high | mitigate | No transaction-log call in the options build; call-count test; injection drill RED | closed |
| T-185-19 | Tampering | cash report mutation | high | mitigate | `dataclasses.replace` copy; deepcopy-equality test; drill RED | closed |
| T-185-20 | Information disclosure | retained raw rows and logs | medium | mitigate | `repr=False, compare=False` verified. Gap: structural-degrade warning logs `scrub_freeform_string(str(exc))`, which redacts credential shapes only; messages can carry a transaction-log row id or instrument name (Railway operational logs only). Below block threshold. Re-audit 2026-11-03: gap unchanged (`analytics-service/services/job_worker.py`, the `_options_exc` warning; `analytics-service/services/redact.py` scrub). Booked, not fixed: see Accepted Risks Log AR-185-01 | closed - accepted and booked (non-blocking) |
| T-185-21 | Denial of service | structural options failure | high | mitigate | Six structural classes caught locally, cash fallback, derive DONE; catch-removal drill RED | closed |
| T-185-22 | Tampering | mixed-basis writer quantities | critical | mitigate | One ledger rebinding; seam test; returns and hybrid drills RED | closed |
| T-185-23 | Tampering | perp-only keys | high | mitigate | `has_option_activity is True` gate; byte-identity test; gate drill RED | closed |
| T-185-24 | Denial of service | unbounded options step | high | mitigate | `asyncio.wait_for` at 0.7 of remaining budget, 60 s floor, local timeout arm; arm, bound and floor drills RED | closed |
| T-185-25 | Tampering | structural catch swallowing transients | medium | mitigate | Transients excluded from the tuple; drill RED | closed |
| T-185-26 | Repudiation | caveat rule | medium | mitigate | Rule follows bucketed days (F2); drill RED | closed |
| T-185-27 | Information disclosure | plan 10 SUMMARY | high | mitigate | Letters only; 0 UUID, home path or `last_error` | closed |
| T-185-28 | Tampering | PROD database and worker variable (plan 10) | critical | mitigate | Marker-first SELECTs; no enqueue (f4-a), no variable flip (F6); SUMMARY states nothing was written | closed |
| T-185-29 | Repudiation | pre-deploy curve read as result | medium | mitigate | Deploy SHAs and CI count recorded; every `computed_at` after the wait start | closed |
| T-185-SC | Tampering | dependency installs | low | accept | No dependency added (package.json version line only; lockfile and requirements untouched). Id repeats in each plan, counted once | closed |

*Status: open - closed*
*Totals: 30 threats, 30 closed (T-185-20 closed by acceptance, AR-185-01), 0 open.*

Verification basis: 45 Python and 294 TypeScript tests green in the worktree; 20 independent neuter drills on scratch copies all went RED. `feat/185-planning` sits on an older base than the shipped commit; the 19 of 24 shipped files that are byte-identical plus a diff review of the other 5 (hunks outside 185 code) support the evidence.

---

## Unregistered Flags (informational)

1. `options_activity` stamp on every Deribit key-mode `key_inputs` row and its reader fail-open rule (added by review WR-02/WR-03, D-13); literal covered by the T-185-11 pin, owner RLS.
2. `options_basis` string in `key_inputs`; fixed basis name, owner RLS.
3. Plan 02 pushed a temporary script variable to the backfill worker; deleted and read back.
4. Plan 03 read through MCP `execute_sql` instead of the file-based CLI; disclosed in its SUMMARY.

---

## Accepted Risks Log

| ID | Threat | Severity | Risk accepted | Reason | Exposure | Date |
|----|--------|----------|---------------|--------|----------|------|
| AR-185-01 | T-185-20 | medium | The structural-degrade warning in `job_worker.py` logs `scrub_freeform_string(str(exc))`. The scrub redacts credential shapes only, so a message can carry a transaction-log row id or instrument name. | Founder rule: a medium finding that is neither user-facing nor data-integrity is booked, not fixed in the phase. No code change was made in this re-audit. | Railway operational logs only; no response body, database row or user-facing surface | 2026-11-03 |

No waiver exists for any high-severity threat. Every high and critical threat in the register is closed by evidence.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-03 | 30 | 28 | 2 (1 blocking) | gsd-security-auditor |
| 2026-11-03 (re-audit) | 30 | 30 | 0 | gsd-security-auditor (T-185-04 closed on the dated read-back; T-185-20 accepted and booked, AR-185-01) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-03 (re-audit)
