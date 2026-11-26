---
phase: "251"
slug: "syncstore-run-sync-trades-job-stores-every-run-s-daily-p-l-a"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-26"
---

# Phase 251 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| venue → worker | `fetch_daily_pnl` returns daily rows and stamps DQ flags into the per-task buffer | venue-derived daily P&L, flag names, exception class names |
| worker → database | `sync_trades` RPC, `strategy_analytics.data_quality_flags` upsert, `advance_sync_cursor` RPC (service role) | daily rows, refusal flag keys, cursor timestamps |
| worker → operator logs | new warning / exception lines | strategy id, closed reason tokens, DB exception text |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-251-01 | Tampering | Phase-1 store replacing a daily span with a refused read's rows | high | mitigate | `daily_pnl_read_verdict` reasons refuse the store before the `sync_trades` RPC (`run_sync_trades_job`); `test_refused_read_stores_nothing` (N2) | closed |
| T-251-02 | Tampering | flag upsert after a failed flag read replacing the column | high | mitigate | skip the write when `flag_load_failed and not phase2_ran`; `test_flag_load_failed_with_flag_off_writes_nothing` (N11) | closed |
| T-251-03 | Information disclosure | raised text, refusal log, stored error class | medium | mitigate | static exception text; reasons are closed tokens; stored class is the verdict's regex-checked identifier (N9) | closed |
| T-251-04 | Denial of service | swallowed rate limit never trips the breaker | medium | mitigate | `verdict.rate_limited` re-raises `ccxt.RateLimitExceeded` into the outer `_stamp_429` arm (N8) | closed |
| T-251-05 | Tampering | cursors advancing past an unstored span | medium | mitigate | `advance_fetched_cursor` and `_p_last_sync` hold on `phase1_read_refused` (N13) | closed |
| T-251-09 | Tampering | a re-read hiccup becoming FAILED and unpublishing a live strategy | high | mitigate | separate `try` scopes; a raising re-read returns DONE (N5, N7, N20; live pin in CI) | closed |
| T-251-06 | Repudiation | cancelled run loses its flag write | low | accept | see Accepted Risks | closed |
| T-251-07 | Denial of service | queued Deribit sync refused every run | low | accept | see Accepted Risks | closed |
| T-251-08 | Information disclosure | flag-only `pending` row from a refused first sync | low | accept | see Accepted Risks | closed |
| T-251-10 | Repudiation | re-read raises on a never-published, rowless strategy | low | accept | see Accepted Risks | closed |
| T-251-11 | Tampering | failed-row write raises after a partial effect | low | accept | see Accepted Risks | closed |
| T-251-12 | Information disclosure | `logger.exception` carries DB exception text | low | accept | see Accepted Risks | closed |
| T-251-SC | Tampering | package installs (plans 01 and 02) | low | accept | see Accepted Risks | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-251-01 | T-251-06 | A run cancelled after the daily store is FAILED in compute_jobs, holds `last_sync_at`, and the next run re-derives the flags (CONTEXT item 1). | phase agent (CONTEXT decision) | 2026-11-26 |
| AR-251-02 | T-251-07 | `fetch_daily_pnl` has no Deribit branch; a queued Deribit sync is refused by name. PROD had 0 Deribit `sync_trades` jobs in 30 days (2026-11-26); pinned by a test; named in the CHANGELOG. | phase agent (CONTEXT research resolution) | 2026-11-26 |
| AR-251-03 | T-251-08 | The row carries `computation_status='pending'`; readers gate on status; pinned by a live arm. | phase agent (RESEARCH A4) | 2026-11-26 |
| AR-251-04 | T-251-10 | Same T-222-13 residual Phase 222 accepted for the identical unreadable condition. | phase agent (CONTEXT decision) | 2026-11-26 |
| AR-251-05 | T-251-11 | The first read found nothing published, so FAILED cannot unpublish a figure. | phase agent | 2026-11-26 |
| AR-251-06 | T-251-12 | Operator-log scope only, same pattern as the surrounding tail; no banned support phrase. | phase agent | 2026-11-26 |
| AR-251-07 | T-251-SC | The diff touches no dependency manifest or lockfile. | phase agent | 2026-11-26 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-26 | 13 | 13 | 0 | gsd-security-auditor (SECURED, ASVS L1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-26
