# Phase 101: Options MTM Toggle (analytics / pnl_basis) - Context

**Gathered:** 2026-07-12
**Status:** Ready for research/planning
**Mode:** Smart discuss — design/grey areas to Fable.

<domain>
## Phase Boundary
MTM-01 core (analytics side): enable the EXISTING factsheet `cash_settlement ↔ mark_to_market` basis toggle for **options-trading** strategies by recomputing returns from the INGESTED API mark data via the EXISTING `pnl_basis=mark_to_market` path (v1.8 machinery). NO new smoothing algorithm (user-rescoped 2026-07-12 — the honest raw mark-to-market curve IS correct; smoothing would fabricate data + understate real unrealized risk). Single-strategy first (composite compose + Zavara regression = Phase 102). `cash_settlement` output stays byte-identical (SC-4).
</domain>

<decisions>
## Locked (user-rescoped 2026-07-12)
- **NO smoothing.** The daily mark-to-market curve from the exchange's mark data is the honest output — its volatility is real unrealized risk (the whole point of the MTM view). Do NOT average/smooth/fabricate. cash_settlement (realized at settlement) is the smooth one; MTM (economic, daily) is the jumpy one — showing the contrast honestly IS the feature.
- **Reuse the existing `pnl_basis` machinery** (v1.8: `compute_all_metrics` pnl_basis cash_settlement/mark_to_market). Do NOT build new valuation logic.
- **Use the exchange's own daily fair-value signal.** ⚠️ CORRECTED by 101-RESEARCH (A1/OQ-1): the honest MTM signal is NOT a `mark_price` column (absent on settlement rows) — it is the ALREADY-INGESTED `options_settlement_summary.realized_pl + unrealized_pl` session delta, which IS Deribit's own daily mark decomposition. Intent holds (exchange fair-value, not last-trade); the field name in the original CONTEXT was wrong. NO custom smoothing.
- **Honest-gate preserved:** if a book genuinely has NO mark data ingested, it still degrades with a reason (disabled-with-reason) — never a fabricated line.
- **SC-4:** `cash_settlement` for every existing strategy stays byte-identical; single-key + composite published metrics unperturbed.

## DELEGATED to Fable (planner):
- How exactly to flip the factsheet toggle-availability gate for options (remove/relax the disabled-with-reason condition where mark data exists) vs where it's genuinely absent.
- Any data-shape/read-path detail the research surfaces.
</decisions>

<code_context>
## Existing (research to confirm file:line)
- The factsheet `cash_settlement ↔ mark_to_market` SegmentedControl + the "disabled-with-reason on un-smoothed options books" GATE (v1.9 Phase-90) — WHERE is it, and what condition disables it for options?
- The v1.8 `pnl_basis` machinery: `compute_all_metrics` pnl_basis cash_settlement/mark_to_market; `services/allocated_capital.py`; how mark_to_market is computed today (what it uses).
- The Deribit ingestion — is the daily `mark_price` (fair-value mark) ingested + available per-day for options? (Zavara = Deribit options book.)
- Composite read-path (`composite-read-path.ts`) — for Phase-102 compose, but note the single-strategy path here.
</code_context>

<specifics>
- Research MUST confirm: (1) the mark data (daily option marks / mark_price) IS ingested for options; (2) the exact pnl_basis=mark_to_market code path + whether it already handles options or bails; (3) WHERE + WHY the factsheet toggle is disabled-with-reason for options (the gate to change); (4) that enabling MTM does NOT touch cash_settlement. If the mark data is NOT ingested, that's a BLOCKER to surface (the toggle can't be honestly enabled without it).
</specifics>

<deferred>
- Composite MTM compose + Zavara regression + factsheet UI wiring = Phase 102.
</deferred>
