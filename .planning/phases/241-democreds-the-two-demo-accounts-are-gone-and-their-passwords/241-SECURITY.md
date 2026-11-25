---
phase: "241"
slug: "democreds-the-two-demo-accounts-are-gone-and-their-passwords"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-25"
audited_at_sha: 6c0a1afd6
---

# Phase 241 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Counts and roles only. This file holds no login, password, id, digest or marker text.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| tracked tree -> public repo | every committed file is public | credential literals (must be absent) |
| guard output -> CI logs and records | failure text is pasted where the guard scans | role, path and line only |
| rehearsal -> local-stack lane | lane only, loopback-asserted | synthetic fixture rows |
| orchestrator MCP session -> PROD database | one-way destructive write, founder-gated | one census-pinned DO statement |
| orchestrator shell -> GoTrue admin API | service-role key in one process environment | the key (never printed) |

---

## Threat Register

| Threat ID | Plan | Category | Severity | Disposition | Mitigation | Status |
|-----------|------|----------|----------|-------------|------------|--------|
| T-241-01 | 01 | Information disclosure | high | mitigate | scrub prints counts only; scratch literal file deleted; whole-tree guard 0 matches | closed |
| T-241-02 | 01 | Information disclosure | high | mitigate | range-form gitleaks clean (01 and 02 SUMMARYs); no skip token or attribution in phase commits | closed |
| T-241-03 | 01 | Tampering | low | mitigate | line-balanced diffs, placeholder counts equal census, exactly 12 files | closed |
| T-241-04 | 01 | Information disclosure | medium | mitigate | no home or scratchpad path in the phase dir; planning hygiene OK | closed |
| T-241-SC | 01 | Tampering | low | accept | nothing installed | closed |
| T-241-05 | 02 | Information disclosure | high | mitigate | `check-demo-credential-digests.ts` chained into `npm run lint`; no path allowlist; unfiltered `frontend-lint` | closed |
| T-241-06 | 02 | Information disclosure | high | mitigate | `formatOffender` prints role, path, line; arm pins it | closed |
| T-241-07 | 02 | Information disclosure | low | accept | short-password digest brute-force accepted (script header "HONEST LIMIT") | closed |
| T-241-08 | 02 | Repudiation of control | high | mitigate | EMPTY-SCAN, UNREADABLE, floors, `verdict`, CLI subprocess arm; PROOF-01 neuters RED | closed |
| T-241-09 | 02 | Information disclosure | high | mitigate | PROOF-01 plants restored by cp, cmp, git diff --quiet | closed |
| T-241-SC | 02 | Tampering | low | accept | node built-ins only | closed |
| T-241-10 | 03 | Tampering | high | mitigate | `--assert-local-handoff`, loopback refusals in lane-users and admin-delete | closed |
| T-241-11 | 03 | Tampering | high | mitigate | in-chain marker check, abort-marker arm and neuter R-04 | closed |
| T-241-12 | 03 | Tampering | high | mitigate | exactly-one login resolve, cross-owner zero checks, ROW_COUNT pins, sibling-key checks; 9 PASS 0 FAIL | closed |
| T-241-13 | 03 | Information disclosure | high | mitigate | tokens only in PAIRB files; no uuid or email in the phase dir | closed |
| T-241-14 | 03 | Denial of service | medium | mitigate | plan precondition halts on another lane; 0 containers after down (process control) | closed |
| T-241-SC | 03 | Tampering | low | accept | existing dependency only | closed |
| T-241-15 | 04 | Tampering | high | mitigate | marker alone before every PROD statement; in-chain marker check (241-04-SUMMARY) | closed |
| T-241-16 | 04 | Tampering | high | mitigate | census pair_b_ids = 1, all zero_* = 0, re-measured; post-verify siblings 4, Pair A present (241-04-SUMMARY) | closed |
| T-241-17 | 04 | Repudiation | high | mitigate | founder go and channel authorization quoted verbatim, UTC dates (241-04-SUMMARY) | closed |
| T-241-18 | 04 | Elevation of privilege | high | mitigate | key in one process, never printed; `--confirm-prod`; channel moved by founder instruction (recorded) | closed |
| T-241-19 | 04 | Denial of service | medium | mitigate | chain committed, admin delete `deleted=1`, post-verify present = 0; no partial state | closed |
| T-241-20 | 04 | Information disclosure | medium | mitigate | SUMMARY carries counts and dates only | closed |
| T-241-21 | 04 | Spoofing | high | transfer | Pair A password reset transferred to the founder (CONTEXT ruling 2026-11-24); human_needed in VERIFICATION | closed (transferred; risk live until reset) |
| T-241-SC | 04 | Tampering | low | accept | nothing installed | closed |

*Status: open · closed · open — below block threshold (non-blocking)*
*Rows resting on PROD or TEST actions are evidenced by the dated orchestrator records in 241-04-SUMMARY.md; the auditor had no database access.*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-241-01 | T-241-07 | Digests of short literals can be brute-forced offline; the literals are already in public history, Pair B is deleted and Pair A is reset by the founder. The table is a tripwire, not secrecy. | planner, CONTEXT [Guard] decision | 2026-11-24 |
| AR-241-02 | T-241-21 | Transferred, not accepted: Pair A's leaked password stays live until the founder resets it. Tracked as a human_needed item. | founder ruling | 2026-11-24 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-25 | 25 register rows (28 counting each plan's SC row and dispositions as the auditor did) | all | 0 | gsd-security-auditor (verdict SECURED), L2-depth reading |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-25. Residual: T-241-21 until the founder resets Pair A's password.
