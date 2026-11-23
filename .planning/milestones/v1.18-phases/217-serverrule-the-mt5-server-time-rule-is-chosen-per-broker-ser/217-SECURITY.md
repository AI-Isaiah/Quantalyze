---
phase: "217"
slug: "serverrule-the-mt5-server-time-rule-is-chosen-per-broker-ser"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-18"
---

# Phase 217 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (217-01 and 217-02 `<threat_model>`); ASVS L1, block_on high.
> Evidence is grep-level (L1), so the auditor was not spawned (secure-phase short-circuit).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Railway env → worker | `MT5_SERVER_TIME_RULES` is operator configuration read by the derive | server-label hashes and rule ids (non-secret, but never echoed) |
| Worker → `compute_jobs` / logs / ops_alert | error texts, log lines and pages leave the worker | rule id and offsets in hours only; never a server name or hash |
| Repo (public) → readers | runbooks and tests are public | `<64-hex>` placeholders and hash prefixes only |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-217-01 | Tampering | `parse_mt5_server_time_rules` | high | mitigate | strict grammar, fault on any malformed entry, no degrade to `{}`; `test_a_malformed_rules_map_fails_loud_with_a_closed_value_free_message`, `test_a_malformed_rules_map_fails_transient_and_makes_no_terminal_read`; two neuters RED (217-01-SUMMARY) | closed |
| T-217-02 | Information disclosure | `_MALFORMED_RULES_MESSAGE` | medium | mitigate | one closed message in `MT5_SERVER_CLOCK_CONFIG_MESSAGES`, no interpolation; planted-value absence asserted; `test_every_new_derive_message_is_blame_free_for_the_mt5_classifier` | closed |
| T-217-03 | Information disclosure | unmapped-drift log and page | medium | mitigate | detail via `format_offset_hours` (rule id and hours); tag is the key uuid; server name/hash absence asserted in `tests/test_mt5_derive_branch.py`; confirmed by code review and silent-failure pass | closed |
| T-217-04 | Tampering (data integrity) | unmapped mismatch branch | high | accept | founder override Q2 (217-CONTEXT.md, ROADMAP) | closed (accepted) |
| T-217-05 | Tampering (data integrity) | mapped mismatch branch | high | mitigate | `Mt5ServerClockSelection.mapped` returned flag; refusal test parametrized with map equal to default; mapped-refuse neuter RED | closed |
| T-217-06 | Denial of service | `unmapped_clock_mismatch` page | low | accept | own hourly window per `(source, cause, event)` | closed (accepted) |
| T-217-07 | Information disclosure | runbook text | medium | mitigate | 64-hex guard: `mt5-go-live.md` 1 match (pre-existing image digest, HEAD baseline 1), `navmtm-chain-move-go-live.md` 0 | closed |
| T-217-08 | Information disclosure | validation one-liner | low | mitigate | prints `len(p())` only; closed error text | closed |
| T-217-09 | Tampering (data integrity) | deploy ordering | medium | mitigate | `mt5-go-live.md` step 3: set on both services BEFORE deploying | closed |
| T-217-SC | Tampering | package installs | high | accept | no dependency added (stdlib only; no requirements or package.json change) | closed (accepted) |

*Status: open · closed · open — below high threshold (non-blocking)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-217-01 | T-217-04 | An unmapped server whose clock disagrees with the default writes days under the default rule (mis-dated until mapped); evidence is the `mismatch` reading row plus the page | Founder (Q2 "Write and alert") | 2026-11-18 |
| AR-217-02 | T-217-06 | New page cause shares the existing hourly windowing | Planner (plan-time register) | 2026-11-18 |
| AR-217-03 | T-217-SC | No package installed | Planner (plan-time register) | 2026-11-18 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-18 | 10 | 10 | 0 | phase 217 orchestrator (secure-phase, L1 short-circuit) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-18
