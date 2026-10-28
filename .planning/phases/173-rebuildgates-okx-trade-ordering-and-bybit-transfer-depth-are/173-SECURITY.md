---
phase: "173"
slug: "rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are"
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-10-28"
---

# Phase 173 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| backfill worker -> OKX / Bybit REST | read-only probe GETs (the rebuild's own read, the raw fills-history ordering read, transfer reads) | decrypted venue keys stay in the worker process; answers held in memory only |
| probe stdout -> tracked SUMMARY / TODOS | operator pastes emitted records into a public repo | counts, booleans, closed tokens, 3-significant-figure ratios only (emitter allow-list) |
| operator -> PROD database / backfill worker | post-ship plan 03: temporary start-command change; a forced rebuild only on an explicit founder yes | marker query first; guarded runbook enqueue |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-173-01 | Information disclosure | `_okx_order_reading` exception path | high | mitigate | exception recorded by `classify_failure` CLASS only, validated by `_is_one_of(_FAILURE_CLASSES)`; leak test with a planted amount | closed |
| T-173-02 | Tampering (data integrity) | `okx_order_gate` | high | mitigate | `okx_order_verdict`: `violated` first, `ok` only when readings equal OKX members with trades (≥1); parametrised test; mutations RED | closed |
| T-173-03 | Tampering (data integrity) | refusal-arm instrument type | medium | mitigate | instrument types taken from the pre-diagnostic `calls` snapshot; pinned on refusal and agreed-anchor arms | closed |
| T-173-04 | Elevation of privilege / Tampering | new venue call | medium | mitigate | only a raw GET in `_okx_order_reading`, bounded by `asyncio.wait_for`; static no-writer / no-venue-write pins green | closed |
| T-173-05 | Tampering (data integrity) | `bybit_transfers_gate` | high | mitigate | per-kind counts only, both ≥1 on the full 730-day window; corroboration feeds no gate; summary roll-up per D-05 pinned | closed |
| T-173-06 | Information disclosure | new evidence fields | high | mitigate | closed validators (counts, closed age buckets, booleans, closed tokens); leak tests for transfer ids and timestamps | closed |
| T-173-07 | Tampering | deployed-code mismatch | medium | mitigate | `BYBIT_TRADE_TERMINUS_DAYS` in `DEPLOYED_ER_NAMES`; `run()` refuses before any decrypt | closed |
| T-173-08 | Denial of service | backfill worker start command | high | mitigate | plan 03 Task 1: background probe in a wrapper, normal start exec'd, restore first, `worker-restored: yes` required by GATES_OK | closed (by procedure, not yet exercised) |
| T-173-09 | Tampering (data integrity) | forced rebuild against a shut gate | high | mitigate | plan 03 Tasks 2–3: no auto-select, rebuild only on explicit founder yes, verbatim scoped override lines, marker query, runbook P0–P6, one guarded job per account | closed (by procedure, not yet exercised) |
| T-173-10 | Tampering | deploy mismatch | medium | mitigate | GATES_OK requires `import-check: 0 16 True True True True` exactly | closed (by procedure, not yet exercised) |
| T-173-11 | Information disclosure | SUMMARY and `TODOS.md` | high | mitigate | uuid and ten-digit greps in GATES_OK and DECISION_OK; scratch dir removal checked | closed (by procedure, not yet exercised) |
| T-173-12 | Tampering | wrong database | high | mitigate | marker query before any write (NULL stops); runbook `DO $guard$` | closed (by procedure, not yet exercised) |
| T-173-SC | Tampering | npm/pip/cargo installs | low | accept | no package installed or upgraded in this phase | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

### Non-blocking residuals (not registered threats)

Round-4 review survivors in the plan 03 GATES_OK chain (R4-SFH-1, R4-SFH-2, review R4 WR-01, WR-02; MEDIUM, recorded-evidence integrity, below `block_on: high`): the `bybit-transfers-unread:` line accepts a duplicate label; the pasted record count is not compared with the summary's `accounts`; `sc2-met`, the label lines, the `okx-order-reading:` fields and the evidence lines are not cross-checked against the records. They cannot open a gate (gates are code-derived and copied) or cause a write (founder yes plus runbook guards). To be tightened, or the criteria reworded, by the orchestrator before plan 03 runs.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-173-SC | T-173-SC | no dependency change in this phase | plan threat model | 2026-10-28 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-28 | 13 | 13 | 0 | gsd-security-auditor (ASVS L1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
