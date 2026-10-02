# Phase 115: E2 allocator equity reconstruction — SCOPE-GATED (verify-first) - Context

**Gathered:** 2026-07-17
**Status:** Ready for research (verify-first) then planning
**Mode:** Design largely founder-locked (STITCH-01..06); the OPEN question is the scope-gate resolution, which RESEARCH must answer before planning the deletion scope.

<domain>
## Phase Boundary

The allocator equity display derives from the per-key daily-series blend on the
unified backbone (allocator IS a strategy through the ONE pipeline:
key→dailies→backbone→UI). The underlying per-key first-writer-wins TWR
reconstruction store (`equity_reconstruction.py`) retirement is GATED on a
reader census — the store is NOT deleted unless the census clears. The KEPT
Modified-Dietz/MWR cashflow path (BACKBONE-01) stays.

IN scope: route the allocator multi-key account through the same strategy
dailies pipeline; derive perf-curve (TWR) vs equity-curve ($) correctly with a
cashflow ledger; the stitch-seam rule. OUT of scope unless the census clears:
physically deleting the equity_reconstruction store / deribit carve-out.
</domain>

<decisions>
## Implementation Decisions (founder-locked — STITCH-01..06)

### STITCH-01 — one pipeline
Route the allocator's multi-key account through the SAME strategy dailies
pipeline (windowed `strategy_keys` stitch → dailies → backbone), NOT the
parallel per-key path. The allocator = a strategy + a current-holdings snapshot.

### STITCH-02 — retire the duplicate reconstruction (CENSUS-GATED)
Retire the per-key first-writer-wins TWR reconstruction (`equity_reconstruction.py`)
+ the deribit carve-out. KEEP the Dietz/MWR cashflow path (BACKBONE-01 — the
backbone cannot reproduce it). ⚠️ The physical store deletion is GATED on the
reader census (the scope gate). If the census does NOT clear, DEFER the store
retirement and ship only the routing/derivation change.

### STITCH-03 — perf-curve ≠ equity-curve
Perf-curve (TWR, cashflow-neutral) ≠ equity-curve ($, steps on
deposits/withdrawals); equal ONLY with zero cashflows. Derive dailies FIRST,
then layer the equity curve = return path + cashflow ledger.

### STITCH-04 — unknown start
Unknown starting value → derive backward from current equity + the known return
path.

### STITCH-05 — external cashflows
Deposits/withdrawals handled via Modified-Dietz/MWR (the KEPT path).

### STITCH-06 — stitch-seam rule (⭐)
A window-boundary equity jump (key N last day → key N+1 first day) is treated as
a SYNTHETIC deposit/withdrawal through the SAME Dietz/MWR ledger — TWR stays
clean across the seam, equity reflects the real jump. Windowed stitch and
cashflow accounting are ONE code path.

### Claude's Discretion
Implementation mechanics (how the ledger is threaded, function boundaries) at
Claude's discretion within the STITCH contract and codebase conventions. The
frozen TypeScript `scenario.ts` engine is NOT touched.
</decisions>

<research_questions>
## Verify-First — RESEARCH MUST resolve the scope gate before planning

1. **Reader census for the store retirement (the gate).** Enumerate every reader
   of the per-key first-writer-wins TWR reconstruction in `equity_reconstruction.py`
   (its `compute_twr` METHOD + reconstruct paths) and the deribit carve-out —
   across `analytics-service/` (services, routers, scripts incl. Railway one-offs,
   cron) AND any SQL/store consumers. Does the census CLEAR (all readers can move
   to the dailies-blend path) or must retirement be DEFERRED?
2. **`routers/match.py` parity.** E2 also feeds match.py scores — the new
   derivation MUST parity-check match/score outputs, not just the dashboard equity
   number. Identify exactly what match.py consumes and how to prove parity.
3. **Cashflow reality.** Where do real deposits/withdrawals enter, where does the
   Dietz/MWR ledger live today (`compute_mwr`/`compute_modified_dietz`, KEPT in
   P114), and can the stitch-seam synthetic-cashflow rule (STITCH-06) reuse it?
4. **Backward-derivation feasibility (STITCH-04)** — is current equity + return
   path reliably available for the unknown-start case?
5. **Interaction with P114:** the delete-gate now allows the `compute_twr` METHOD
   in `equity_reconstruction.py` only as a `self`-method; STITCH-02's deletion must
   keep that gate GREEN (or update it deliberately).
</research_questions>

<code_context>
## Existing Code Insights (scout — verify in research)
- `analytics-service/services/equity_reconstruction.py` — the store to (conditionally) retire; `compute_twr` is a METHOD (~L2972), P114-exempted in the delete-gate.
- `analytics-service/services/nav_twr.py` — reconstruct_nav_and_twr (interior-NaN guard days at L843, relevant to P114 fix).
- `analytics-service/services/metrics.py` — the unified backbone (`compute_all_metrics`) + P114 helpers; KEPT `compute_mwr`/`compute_modified_dietz` live in `services/portfolio_metrics.py`.
- `analytics-service/routers/match.py` — score consumer (parity target).
- Other touchers of reconstruction/deribit: transforms.py, position_reconstruction.py, allocated_capital.py, deribit_txn.py, funding_fetch.py, positions.py, audit.py (census must cover these).
</code_context>

<specifics>
## Specific Ideas
Reuse the `strategy_keys` windowed stitch that already exists for multi-key
composite strategies (v1.9 multi-key composite milestone) — the allocator is the
same shape. Ground-truth parity check against a real allocator account
(deribit_ground_truth.py pattern), covering BOTH the equity number AND match.py
scores.
</specifics>

<deferred>
## Deferred Ideas
- If the reader census does NOT clear: DEFER the physical store deletion; ship
  only the routing/derivation change + leave the store in place behind the new
  path. Record the residual readers as follow-up.
</deferred>
