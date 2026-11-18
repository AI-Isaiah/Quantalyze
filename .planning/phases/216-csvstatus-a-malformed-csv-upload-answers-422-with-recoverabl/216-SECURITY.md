---
phase: "216"
slug: "csvstatus-a-malformed-csv-upload-answers-422-with-recoverabl"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-18"
---

# Phase 216 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Next.js routes → analytics `/process-key` | Bearer-authenticated internal seam; status and body forwarded verbatim by `postProcessKey` | CSV upload bytes (caller data, may carry PII in cells); error envelope back |
| analytics → caller (error envelope) | The new 422 arm's envelope, incl. projected `pandera_errors` rows | rule/row/message/column only, never the raw failing cell |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-216-01 | Information disclosure | new 422 arm `debug_context` | medium | mitigate | `_envelope_error(..., source_debug_context=val.debug_context)` → `_forwarded_pandera_rows` projection; `failure_case` never crosses. Pinned by `test_sync_pipeline_rejection_also_forwards_the_breakdown` (`_PII_MARKER not in r.text`, now at 422) | closed |
| T-216-02 | Tampering / Elevation | discriminator `body.source == "csv"` | low | mitigate | Non-csv sources fall through to the unchanged 424 pre-gate / 403; `PERMANENT_VALIDATION_ERROR_CODES` untouched. Pinned by the `teaser-csv-looking-code` and `csv-upstream-fail` rows and `test_permanent_set_is_exactly_the_five_pinned_codes` | closed |
| T-216-03 | Repudiation | rejection observability | low | mitigate | `process_key.write_capable_key_rejected` still logs first; new `process_key.csv_validation_rejected` log with reject_code, verification_id, correlation_id; draft transition pinned on the 422 path (fix 766d2c33b) | closed |
| T-216-04 | Denial of service | breaker accounting | low | accept | 424 → 422 stays 4xx; `resilient-fetch.ts` unchanged and never records a 4xx | closed |
| T-216-SC | Tampering | npm/pip installs | high | mitigate | `git diff 3f978cbaf HEAD -- package.json package-lock.json analytics-service/requirements*.txt` empty | closed |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-216-01 | T-216-04 | A 4xx status move cannot change breaker accounting; nothing to mitigate | plan-time register (216-01-PLAN) | 2026-11-18 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-18 | 5 | 5 | 0 | gsd-security-auditor (ASVS L1, block_on high) |

Auditor observation (not a flag): `human_message` and row `message` are forwarded from the CSV adapter exactly as before this phase; T-216-01's mitigation scope is the raw failing cell, which stays withheld.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-18
