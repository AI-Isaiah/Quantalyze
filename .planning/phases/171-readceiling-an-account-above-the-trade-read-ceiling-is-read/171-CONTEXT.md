# Phase 171 READCEILING - Context

**Gathered:** 2026-10-27
**Status:** Ready for planning

<domain>
## Phase Boundary

An allocator account whose trade history is larger than the rebuild's per-run read limits (a6: one Bybit member, 127471 trades read in 1378 calls before `truncated`) is read in full across runs instead of refusing identically on every attempt. Bybit linear executions are the measured case; the mechanism is shared by the rebuild's trade walks.

</domain>

<decisions>
## Implementation Decisions

### Carried (not re-asked)
- TRADEPAGES 167.2.1.1.2.1 D-01 ("Shorten the window"), D-02 (a walk stops only on an empty page, a non-advancing cursor or the window end; Bybit in 7-day windows), D-05 ("Rebuild none, book follow-ups").
- ACCTREBUILD 167.2.1.1.2 D-01..D-03: older stored days kept; a stored in-window day the rebuild does not reproduce refuses the account and writes nothing; the seam is recorded. UPNLVENUES D-04/D-05 and ACCTREBUILD AR-5/AR-7: one window shared by all members, anchor required.
- RECONMARKER 167.1.2.1 D-06, D-09, D-14, D-17 (daily re-enqueue, stop after 5 attempts, non-gating note, attempts counted in SQL).
- The forced-refusal vocabulary is a closed, pinned set; a new token moves the pin test, the probe and the handoff together.
- Never write a partial read as the whole history (TRADEPAGES REVIEW-2 WR-01).

### D-01 Measure first
The first plan re-probes a6 (read-only, counts only, the allocator_history_probe pattern) and records which limit stopped the read (the 100-page window ceiling vs the stall/no-progress site), the window age bucket, call count and elapsed seconds. The probe's closed record schema changes with it. Code that depends on which limit fired waits for this reading.

### D-02 Read model: resumable across runs
Founder 2026-10-27, AskUserQuestion: "Resumable across runs" (chosen over the recommended single time budget with stall-splitting). The read position and what has been read are kept between runs so a book of any size eventually completes; each run reads within the existing crawl bound and defers (`defer_compute_job`) instead of refusing. Nothing is written to the allocator's history until the read is complete (ACCTREBUILD D-02). Persisted trade data needs a migration with owner/service-role RLS and an expiry, migration-reviewer and rls-policy-auditor clean before merge (PROD auto-applies after TEST), and a catalogue-only verify block.

### Claude's Discretion
- What is persisted (raw trades vs fold state), how the fixed two-year edge and the moving `now` are pinned at job start, and the expiry.
- Whether OKX walks use the same mechanism in this phase or stay booked (OKX ordering is Phase 173's gate).
- How a job that keeps making no progress is stopped by name (a stall still refuses loud; a resumable read never loops forever).

</decisions>

<code_context>
## Evidence and starting points
- `analytics-service/services/equity_reconstruction.py`: `_fetch_bybit_trades` (ceiling `_BYBIT_WINDOW_PAGE_CEILING`, stall raise), generic walk 500-page limit, `TruncatedTradeRead`, `_RECONSTRUCT_CRAWL_TIMEOUT_S`=1500.
- `analytics-service/scripts/allocator_history_probe.py`: logging off, `_probe_member` maps every truncation to `truncated`, `ACCOUNT_RECORD_KEYS`.
- `analytics-service/services/okx_archive_job.py` CLAIM_BUDGET pattern; `job_worker.py` handler timeout; `main_worker.py` watchdog.
- Existing ceiling tests in `tests/test_trade_pages.py` use an infinite fake; SC-2 needs a finite over-ceiling book read whole, RED at base.
</code_context>

<canonical_refs>
## Canonical References
- TODOS `167.2.1.1.2.1-READ-CEILING-STRANDS-ACCOUNT`.
- `.planning/phases/167.2.1.1.2.1-*/` CONTEXT, 06-SUMMARY, RESEARCH, REVIEW-2.
- `.planning/phases/167.2.1.1.2-*/167.2.1.1.2-CONTEXT.md`, `.planning/phases/167.1.2.1-*/167.1.2.1-CONTEXT.md`.
- `supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql`.
</canonical_refs>

<deferred>
## Deferred Ideas
- Showing a shorter recent span while the read completes (not chosen).
- Phase 173 REBUILDGATES (Bybit transfer depth, OKX order) depends on this phase.
</deferred>
