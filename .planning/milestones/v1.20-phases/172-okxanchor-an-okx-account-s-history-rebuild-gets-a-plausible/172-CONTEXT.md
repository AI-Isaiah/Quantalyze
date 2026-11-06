# Phase 172 OKXANCHOR - Context

**Gathered:** 2026-10-27
**Status:** Ready for planning

<domain>
## Phase Boundary

The OKX account a4 whose forced rebuild refuses `anchor_skipped_implausible` (TRADEPAGES probe 2026-10-26: 1282 trades in 22 calls) gets a measured root cause, and an OKX account with a correct balance anchors and rebuilds while a truly implausible anchor still refuses by name.

</domain>

<decisions>
## Implementation Decisions

### Carried (not re-asked)
- UPNLVENUES 167.2.1.1 PD-H: a forced rebuild writes only a curve anchored to today's venue equity including open profit; otherwise it fails permanent with a named reason and writes nothing. PD-I: no automatic re-crawl.
- ACCTREBUILD 167.2.1.1.2: OKX window 89 days back; each member anchored to its own `totalEq`; D-01..D-03.
- TRADEPAGES D-05: stored histories stay as recorded.
- NAVMTM D-06, D-09: marks are write-once, start at deploy, never back-filled.
- The forced-refusal vocabulary is a closed, pinned set.

### D-01 Diagnose, then check independently
Founder 2026-10-27, AskUserQuestion: "Diagnose, then check independently (Recommended)".
1. A read-only diagnostic run on a4 on the backfill worker (probe pattern, counts, booleans and 3-significant-figure ratios only: `totalEq / replay_final`, replay sign, non-stable share, `upl / totalEq`, flip-from-flat closes, negative-quantity assets, in-window flows, skipped symbols) measures the cause (SC-1).
2. If the cause is money held before the 89-day window, the implied opening balance (`anchor - replay_final`) is checked against an independent source (OKX bill balances); the rebuild anchors when they agree within a stated tolerance and refuses `anchor_skipped_implausible` when they do not.
3. If OKX cannot supply that independent source, a4 is recorded as a correct refusal with the measured reason.

### Measured 2026-10-27 (PROD, counts only)
`audit_log` `allocator.equity.reconstruct_complete` rows carrying `anchor_offset_implausible`: OKX 2 rows / 2 keys, both false (2026-10-02..10-15); 35 older OKX rows predate the flag. No evidence the refusal is common across OKX accounts, so a4 needs its own reading.

### Claude's Discretion
- The new rule applies to the forced path; whether it also replaces the unforced path's unanchored zero-cash curve is a planner call to state explicitly.
- Anchor stays the live `totalEq` read; stored NAV marks are a later out-of-sample check, not the anchor.
- Tolerance value, chosen from the measurement.

</decisions>

<code_context>
## Evidence and starting points
- `analytics-service/services/equity_reconstruction.py` anchor block (`_implausible_anchor = last_value > 0 and abs(offset) > 5.0 * abs(last_value)`), refusal-token order, OKX 89-day window, `_compute_daily_equity` starting from zero cash.
- `analytics-service/services/exchange.py` `fetch_okx_total_equity_and_upl_usd`, bills-archive read.
- `test_ana_recon_audit.py::test_c01_03_implausible_offset_skips_anchor` restates the formula and cannot fail; SC-2 needs an OKX-shaped test through `_fetch_and_price_window`.
- Phase 173 depends on 172: the probe's ordering read sits behind a4's anchor refusal.
</code_context>

<canonical_refs>
## Canonical References
- TODOS `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE`, `167.2.1.1.2.1-OKX-ORDER-UNMEASURED`.
- `.planning/phases/167.2.1.1-*/167.2.1.1-05-PLAN.md` (PD-H), `167.2.1.1.2-*`, `167.2.1.1.2.1-*` CONTEXT.
</canonical_refs>

<deferred>
## Deferred Ideas
- Validating rebuilt day shapes against accumulated NAV marks (needs about a week of marks).
</deferred>
