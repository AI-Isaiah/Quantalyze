---
phase: "186"
slug: "derivegaps-the-per-key-derive-refuses-a-truncated-or-failed"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-05"
---

# Phase 186 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Operator → PROD database | Read-only SC-1 and SC-5 readings (plans 01, 14) | Counts only; marker query first and alone |
| Worker → venue APIs | Derive and the one-off probe read OKX and Bybit with decrypted keys | Credentials stay in-process; the probe's exchange view is GET-only |
| Worker → `allocator_equity_derived` | Owner-only `read_incomplete:` markers and `failing_key_exits` in the curve payload | Key id, closed token, class name, ISO day; no amount or venue message |
| Database → browser (`queries.ts`) | The dashboard reads failing-key exits for the signed-in owner | Resolved against the owner's own keys only |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-186-01 | Info disclosure | 186-01-SUMMARY | high | mitigate | Bucket/count rows only; scan clean (SUMMARY attestation) | closed |
| T-186-02 | Tampering | PROD DB (plan 01) | critical | mitigate | Marker first and alone, reads only (SUMMARY attestation) | closed |
| T-186-03 | Tampering | probe exchange calls | high | mitigate | `ReadOnlyRecordingExchange.__getattr__` allows GET prefixes and closed read methods only; write names raise, with a test that can fail | closed |
| T-186-04 | Info disclosure | probe records | high | mitigate | `emit_record` → `validate_record` + `assert_sanitized`, the only stdout path | closed |
| T-186-05 | Info disclosure | decrypted credentials | high | mitigate | In-process decrypt; `main()` prints the exception type only, logging disabled | closed |
| T-186-06 | Tampering | `pair_onchain_with_unified` | low | mitigate | Only the probe calls it outside tests | closed |
| T-186-07 | Info disclosure | Gap 2 / Gap 4 records | high | mitigate | 3-sig-fig ratio validators; tests show a planted venue message and `billId` are absent | closed |
| T-186-08 | DoS | worker start command (plan 04) | high | mitigate | Start command restored and worker started normally (SUMMARY attestation) | closed |
| T-186-09 | Tampering | deploy mismatch | medium | mitigate | `fingerprint-expected` equals `import-check` in 186-04 and 186-14 | closed |
| T-186-10 | Info disclosure | 186-04-SUMMARY | high | mitigate | Scan clean | closed |
| T-186-11 | Elevation of privilege | executor reaching Railway/PROD | high | mitigate | Orchestrator-run, founder approval recorded per run | closed |
| T-186-12 | DoS | key history over the budget | high | mitigate | Implemented as a read deadline (`read_deadline_s`, flag `daily_pnl_deadline_<venue>`) below the crawl timeout. It is transient on the first attempt and permanent from the second (review R2-05), not the truncated flag the plan named; the threat's intent, a key retried forever, is closed | closed |
| T-186-13 | Info disclosure | `error_class` | medium | mitigate | `_DAILY_PNL_ERROR_CLASS_RE` keeps a class name only; tested | closed |
| T-186-14 | Tampering | OKX funding dedup | high | mitigate | Conditional branch: `q-g4: no-pairs` (okx=0, bybit=0) so dedup stays on `match_key` per D-04; Bybit two-leg guard test; residual booked as `[186-FUNDING-FEES-SAME-HOUR-LEG]` | closed |
| T-186-15 | Info disclosure | `FundingRowsMalformed` message | medium | mitigate | Message carries venue and count only | closed |
| T-186-16 | Info disclosure | `failing_key_exits` payload | medium | mitigate | `{api_key_id, reason, day}` only; tested | closed |
| T-186-17 | Repudiation | name without exit or exit without name | medium | mitigate | `departed_end_by_key` and `failing_key_exit_by_key` set together; compose validates | closed |
| T-186-18 | Info disclosure | another owner's key id | high | mitigate | `readFailingKeyExits` resolves against the owner's keys and skips unknown ids | closed |
| T-186-19 | Tampering | malformed payload entries | medium | mitigate | Closed reason set, calendar-day or null, shape check; tested | closed |
| T-186-20 | Info disclosure | reader logs | medium | mitigate | Counts only; tested | closed |
| T-186-21 | Info disclosure | refusal message and marker | high | mitigate | `READ_INCOMPLETE_TOKENS` and `_READ_INCOMPLETE_CLASS_RE`; marker in `allocator_equity_derived`, not `data_quality_flags` | closed |
| T-186-22 | Spoofing | marker under the wrong owner | high | mitigate | `allocator_id` from the key row's `user_id`; tested | closed |
| T-186-23 | Tampering | partial series published as complete | high | mitigate | DQ drain right after the realized read; every refusal returns before any write; neuter proof in 186-09 | closed |
| T-186-24 | DoS | deterministic refusal retried forever | medium | mitigate | Only `daily_pnl_fetch_error` and `read_deadline` are transient; the rest are permanent | closed |
| T-186-25 | Tampering | Bybit flow double count or drop | high | mitigate | Bybit flows from `fetch_bybit_unified_flows` only (`g2-flow-final: replace`) | closed |
| T-186-26 | Info disclosure | Unified read failures | medium | mitigate | Closed token plus class name | closed |
| T-186-27 | Tampering | failing key carried flat | high | mitigate | Exit through `departed_end_by_key`; `FAILING_KEY_SERIES_ENDED` out of `_BLOCKING_REASONS`; oracle test with neuter proof | closed |
| T-186-28 | Repudiation | key leaving unseen | medium | mitigate | Every exit and exempt never-derived key recorded; parity fixture | closed |
| T-186-29 | Info disclosure | compose logs | medium | mitigate | Counts only | closed |
| T-186-30 | Tampering | PROD DB (plan 14) | critical | mitigate | Marker first and alone, SELECT/WITH only (SUMMARY attestation) | closed |
| T-186-31 | DoS | worker start command (plan 14) | high | mitigate | `worker-restored-sc5: yes` | closed |
| T-186-32 | Info disclosure | 186-14-SUMMARY | high | mitigate | Scan clean (only a commit sha matches a digit run) | closed |
| T-186-33 | Tampering | cross-runtime drift | medium | mitigate | Python and TS parity tests read the same fixtures; neuter proof in 186-12 | closed |
| T-186-34 | Tampering | composite member truncated series | high | mitigate | Conditional branch `q-composite: book`: booked as `[186-COMPOSITE-MEMBER-READ-GAPS]`; PROD exposure 0 composite strategies with a ccxt member | closed |
| T-186-35 | Tampering | composite Bybit member flows | high | mitigate | Same booked branch as T-186-34 | closed |
| T-186-SC | Tampering | package installs (all plans) | low | accept | No manifest or lockfile changed | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

Evidence notes:
- T-186-01, -02, -08, -09, -10, -11, -30, -31 and -32 are PROD and Railway operational steps. They rest on the dated SUMMARY lines, not on code.
- T-186-14, -34 and -35 close on their plans' own conditional branches. The PROD count the founder's ruling waited for showed no exposure, and each residual is booked by name. Under a strict "code present" reading they would be open.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-186-01 | T-186-SC | The phase installs no package; the supply-chain risk is the repo's standing one | plan-time register (all 14 plans) | 2026-11-05 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-05 | 36 | 36 | 0 | gsd-security-auditor (ASVS L1, block_on high) |

Not mapped to a threat id, informational: the migration `20261105120000_sync_status_protect_refused_derive.sql` keeps `sync_strategy_analytics_status` SECURITY DEFINER with `search_path = public, pg_catalog` and EXECUTE for `service_role` only. The `ci.yml` change moves SQL anti-skip floors only.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-05
