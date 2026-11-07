---
phase: "203"
slug: "b3trunc-why-book-b3-carries-window-truncated"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-07"
---

# Phase 203 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| tracked text to the public repo | the report, the SUMMARY, the review records and the test docstring are published | labels, ISO days, tokens and counts only |
| executor to PROD | none in this phase; one read-only orchestrator reading, no write | none written |
| test to production code | neuters edited `allocator_equity_derive.py` temporarily and restored it byte-exact | source file, restored |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-203-01 | Information disclosure | phase-dir records | high | mitigate | Greps over every phase `*.md` for uuid shapes, home paths and credential shapes found nothing; the only hits are the plan's own verify regex and a checklist line naming the shapes | closed |
| T-203-02 | Tampering | PROD stored rows | high | mitigate | No PROD write and no re-derive; the only non-records change is one test file, with no write path | closed |
| T-203-03 | Tampering | `allocator_equity_derive.py` left neutered | high | mitigate | `git diff 498217b1e..HEAD -- analytics-service/services` is empty and the working tree there is clean; each neuter (including the fixer round's `key_last` neuter) was restored with `cp` and confirmed with `cmp` | closed |
| T-203-04 | Repudiation | a test that cannot fail | medium | mitigate | Two `gc-203-neuter` lines with `result=red restored=identical` in `203-01-SUMMARY.md`, plus the fixer's recorded RED for the `key_last` arm in `203-REVIEW-DISPOSITION.md` | closed |
| T-203-05 | Tampering | skip trailer or attribution trailer | medium | mitigate | A case-insensitive grep of every commit message on `498217b1e..HEAD` for the CI-skip tokens and attribution trailers found nothing; in the phase files the only match is the plan's negated verify regex | closed |
| T-203-SC | Tampering | package installs | low | accept | No lockfile, requirements or package manifest in the diff | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-203-01 | T-203-SC | Nothing is installed in this phase, so there is no supply-chain surface | plan 203-01 threat register | 2026-11-07 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-07 | 6 | 6 | 0 | gsd-security-auditor (ASVS 1, block_on high): SECURED |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-07
