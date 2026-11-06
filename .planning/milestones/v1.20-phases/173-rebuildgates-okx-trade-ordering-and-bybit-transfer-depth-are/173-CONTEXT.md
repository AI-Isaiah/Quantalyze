# Phase 173: REBUILDGATES — OKX trade ordering and Bybit transfer depth are measured live - Context

**Gathered:** 2026-10-28
**Status:** Ready for planning

<domain>
## Phase Boundary

The two gates that block any OKX or Bybit history rebuild are measured on the live worker: OKX's fills ordering on a multi-page read (`okx-order: ok` or `violated`, never `unmeasured`), and how far back Bybit serves deposits and withdrawals, per kind, on a 730-day account. The gates' outcome then decides, with the founder, which stored OKX and Bybit histories are rebuilt.

Starting state (post-deploy probe 2026-10-28, counts only): a4, the only OKX account, is still refused `anchor_skipped_implausible`. The Phase 172 bills check reports `opening_check=unavailable` with reason `chain_break` after walking 1489 bills, so the forced read never reaches the probe's OKX ordering read (`okx_order_readings=0`). The founder booked a separate follow-up phase for the chain_break (OKXBILLSCHAIN). a6 (Bybit) read in full: 203279 trades, 2158 calls, 1048 s.

</domain>

<decisions>
## Implementation Decisions

### Carried (not re-asked)
- TRADEPAGES 167.2.1.1.2.1 plan 06 gate wording: `okx-order: ok` when violations are 0, full-page stops are 0, and every account whose OKX read went past one page carries at least one ordering reading; `violated` when either count is above 0; `unmeasured` otherwise. `bybit-transfers: ok` only when every Bybit account whose window reaches 729 days back shows BOTH a deposit and a withdrawal older than 365 days.
- TRADEPAGES D-05: stored histories stay as recorded ("Accept as recorded").
- UPNLVENUES PD-H / PD-I: a forced rebuild writes only an anchored curve, otherwise refuses by name and writes nothing; no automatic re-crawl.
- OKXANCHOR 172: the forced-refusal vocabulary is a closed, pinned set; the probe's redaction contract (labels, counts, booleans, closed tokens, 3-significant-figure ratios, no id/amount/timestamp finer than the run date) stays.

- **D-01 — OKX half: read the ordering without the anchor**
Founder 2026-10-28, AskUserQuestion: "Read order without anchor (Recommended)".
The probe also takes its raw OKX fills-order read when the member is refused, so 173 measures OKX ordering on a4 now. Rebuilding a4 still waits on the bills-chain follow-up (OKXBILLSCHAIN).

- **D-02 — Bybit depth: a 0 stays unmeasured**
Founder 2026-10-28, AskUserQuestion: "0 stays unmeasured (Recommended)".
The strict rule applies: a per-kind count of 0 older than 365 days keeps that kind `unmeasured` and the gate stays shut for it. The probe records corroboration evidence (for example whether the account's oldest fill is older than its oldest deposit) for the founder to judge at the checkpoint; that evidence does not open the gate by itself. The probe carries per-kind counts (deposits and withdrawals older than 365 days) as permanent record fields; the pooled `transfers_older_365d` stays for lineage.

- **D-03 — Probe mode: full probe, no transfers-only mode**
Founder 2026-10-28, AskUserQuestion: "No, full probe".
This is a founder choice over the recommended transfers-only mode. The operator step re-runs the full probe; no transfers-only mode is built.

- **D-04 — Rebuilds: decided in 173, none by default**
Founder 2026-10-28, AskUserQuestion: "Decide in 173, none by default (Recommended)".
The post-deploy checkpoint records both gate readings (`okx-order:` and `bybit-transfers:`) and asks the founder which histories to rebuild. A forced rebuild runs in 173 only on an explicit yes; otherwise D-05 carries and the rebuild is booked as a follow-up.

- **D-05 — Bybit summary gate: count readable accounts, list refused ones**
Founder 2026-10-28, AskUserQuestion: "Count readable, list refused (Recommended)".
The summary `bybit_transfers_gate` reads `ok` only when at least one account is applicable and every applicable account reads `ok`; an account refused at selection does not shut it (the rebuild refuses that account at the same selection, so an `ok` opens nothing for it). Accounts refused at selection are named on a `bybit-transfers-unread:` line in plan 03. No ROADMAP scope change.

### Claude's Discretion
- Exact record-field names for the per-kind counts and the corroboration evidence, within the existing emitter vocabulary and redaction contract.
- Whether the ordering read covers one instrument type (the busiest, as today) or every type that returned at least two rows, as long as each OKX member that read trades past one page carries at least one reading.
- Operator steps (Railway probe run, PROD marker query, any forced-rebuild enqueue) are checkpoint tasks for the orchestrator, never for a dispatched executor.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `analytics-service/scripts/allocator_history_probe.py`: `_read_member` (forced read, then one raw `private_get_trade_fills_history` read on `_busiest_inst_type(recorder.calls)`), `okx_newest_first`, `okx_passes_ended_full`, `transfers_older_than`, `_TradeRecorder` (records trades and per-kind transfers as `(kind, id, timestamp)`), `_probe_member` refusal arm (`except er.ForcedRebuildRefusedError`), `_account_record`, `emit_record` / `assert_sanitized`.
- `analytics-service/services/equity_reconstruction.py`: `_fetch_and_price_window`, `fetch_ccxt_transfers` windows for deposits/withdrawals, `FORCED_REBUILD_REFUSAL_REASONS`.
- `analytics-service/tests/test_allocator_history_probe.py`: probe tests and the record-vocabulary pins.

### Established Patterns
- The ordering read sits after `_fetch_and_price_window(..., require_anchor=True)`; a refusal raises before it, so the refusal arm has `recorder.calls` (the forced pass's pages) but no ordering reading. That is the root cause of `okx_order_readings=0`.
- The recorder snapshot is taken before the anchor diagnostic so diagnostic calls do not count as the forced pass; the new ordering read must keep that separation.

### Integration Points
- Probe record keys and the summary record (declared vocabularies at the top of the probe module); the post-deploy operator step reads them into the gate lines.

</code_context>

<specifics>
## Specific Ideas

- TODOS `167.2.1.1.2.1-OKX-ORDER-UNMEASURED` closes when `okx_order_readings` equals the number of OKX members that read trades and violations are 0 (or the walk stops relying on ordering).
- TODOS `167.2.1.1.2.1-BYBIT-TRANSFER-DEPTH-UNMEASURED` closes when deposits and withdrawals older than 365 days are counted separately on a real Bybit key, or the window is shortened to what is served.
- TRADEPAGES REVIEW-3 WR-07: pooled counts let one kind pass the gate for the other; the per-kind fields remove that.

</specifics>

<canonical_refs>
## Canonical References
- TODOS `167.2.1.1.2.1-OKX-ORDER-UNMEASURED`, `167.2.1.1.2.1-BYBIT-TRANSFER-DEPTH-UNMEASURED`, `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE`.
- `.planning/phases/167.2.1.1.2.1-*/167.2.1.1.2.1-06-PLAN.md` (gate definitions), `-06-SUMMARY.md`, `-REVIEW-3.md` (WR-05, WR-07).
- Phase 172 OKXANCHOR CONTEXT and plan 05 (post-deploy probe pattern).
- Phase 171 READCEILING (Bybit account read whole, across claims).
</canonical_refs>

<deferred>
## Deferred Ideas

- Fixing a4's bills `chain_break` so its anchor can be checked and a4 rebuilt: the OKXBILLSCHAIN follow-up phase.
- A transfers-only probe mode: declined by the founder (D-03).
- Changing the OKX walk so it no longer relies on newest-first ordering.

</deferred>
</content>
</invoke>
