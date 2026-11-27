---
phase: "242"
slug: "secretshygiene-the-full-history-is-scanned-on-a-schedule-and"
status: verified
threats_open: 0
asvs_level: 1
created: "2026-11-27"
---

# Phase 242 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail. Register built from the six PLAN `<threat_model>` blocks; verified by gsd-security-auditor (ASVS L1, block on high), verdict SECURED.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| git history → scheduled runner → public issue | gitleaks reads every commit of main; only a count leaves the runner | credential-shaped strings (redacted, never filed) |
| `system_settings.analytics_service_url` writer → SECURITY DEFINER ticks → pg_net | app-admins and service_role can write the url; the ticks post the Vault key to it | the analytics service key |
| GitHub release → runner | the gitleaks tarball | executable, sha256-verified |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-242-01 | Info Disclosure | three-part global ignore line | high | mitigate | four-part shape pin + daily binary self-test | closed |
| T-242-02 | Tampering | malformed (inline-comment) ignore line | medium | mitigate | shape pin + self-test inline-comment check | closed |
| T-242-03 | Info Disclosure | scan printing or filing a credential | high | mitigate | `--redact`, no `-v`, report in RUNNER_TEMP, count-only issue | closed |
| T-242-04 | Tampering | tampered gitleaks binary | medium | mitigate | hard-coded sha256 checked before extract, pinned equal to supabase-migrate.yml | closed |
| T-242-05 | DoS | red scheduled run blocking a redeploy of main's head | low | accept | founder-accepted coupling (164.9.6 D-11), stated in header and issue | closed |
| T-242-06 | Info Disclosure | url repointed at another Railway host | high | mitigate | exact two-origin CHECK + in-body equality guard in all four functions; W1/U3 arms | closed |
| T-242-07 | Repudiation | whitespace-only key posted | medium | mitigate | `btrim(v_key, E' \t\r\n')` guard; K1 arms | closed |
| T-242-08 | Tampering | body posting something other than the Vault secret | medium | mitigate | P2 arm compares header to the seeded secret | closed |
| T-242-09 | Elevation of Privilege | EXECUTE on re-created SECDEF ticks | high | mitigate | REVOKE from PUBLIC/anon/authenticated/service_role; verify block; G1 arms | closed |
| T-242-10 | Info Disclosure | refusal echoing the url | medium | mitigate | message never binds the stored value; C3 arms | closed |
| T-242-11 | Info Disclosure | prober/ops tick posting to a sibling | high | mitigate | W1 arms in both gates | closed |
| T-242-12 | Repudiation | whitespace key in prober/ops tick | medium | mitigate | K1 arms in both gates | closed |
| T-242-13 | Tampering | twins left mutating dead migration text | medium | mitigate | all twins repointed at the new migration (R3 kept by design) | closed |
| T-242-14 | Info Disclosure | CHECK still admitting a sibling | high | mitigate | `= ANY` CHECK; U3 arm; verify block refuses old shape | closed |
| T-242-15 | Info Disclosure | match_engine_cron_tick posting to a sibling | high | mitigate | guard before post; W1/K1 arms | closed |
| T-242-16 | Tampering | rollback against the wrong database | high | mitigate | marker-query header, catalogue pre/postconditions | closed |
| T-242-17 | Info Disclosure | rollback re-opening the wildcard | medium | accept | stated in the rollback header; postcondition proves the state | closed |
| T-242-18 | Tampering | arms floor below the corpus | medium | mitigate | ARMS_FLOOR 1079→1089, ci.yml sum 589→599 | closed |
| T-242-19 | Repudiation | sentinel table disagreeing with a gate | low | mitigate | ci.yml rows moved to runner-measured values | closed |
| T-242-20 | Info Disclosure | credential-shaped text in the phase's own commits | high | mitigate | full-history, range and squash-shaped scans all clean | closed |
| T-242-21 | Repudiation | stale TODOS/runbook describing the suffix rule | low | mitigate | entries deleted, runbooks updated, dispatch entry annotated | closed |
| T-242-SC | Tampering | package installs (plans 01-06) | low | accept | no manifest change; only the checksum-verified tarball | closed |

*Status: open · closed · open — below high threshold (non-blocking)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-242-01 | T-242-05 | A red full-history scan attaches a failing check to main's head SHA and can block a Railway redeploy of that SHA; same coupling as the SQL nightly. Chosen by the phase agent under the coordinator's brief, reported to the founder for override. | phase agent (founder accepted the same coupling in 164.9.6 D-11) | 2026-11-27 |
| AR-242-02 | T-242-17 | Running the manual rollback restores the suffix wildcard by definition. | phase agent | 2026-11-27 |
| AR-242-03 | T-242-SC | No dependency added. | phase agent | 2026-11-27 |

Out of register, recorded for the founder: the loopback origin stays allowed on PROD, so an app-admin can still point every tick (both alarms included) at a discard port. Pre-existing, not a key leak.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-27 | 22 | 22 | 0 | gsd-security-auditor (ASVS L1) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-27
