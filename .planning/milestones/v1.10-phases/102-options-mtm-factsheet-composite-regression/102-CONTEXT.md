# Phase 102: Options MTM Factsheet + Composite + Regression - Context

**Gathered:** 2026-07-12
**Status:** Ready for research/planning
**Mode:** Smart discuss — design/grey areas (toggle-enable UX, reason copy) DELEGATED to Fable (planner/UI), per user standing directive.

<domain>
## Phase Boundary
The FINAL phase of v1.10. Three deliverables, building on Phase 101's analytics-side second MTM pass:
- **MTM-01 UI (read-side):** enable the EXISTING factsheet `cash_settlement ↔ mark_to_market` SegmentedControl for a **single-key options-trading** strategy — render the `mark_to_market` metrics that Phase 101 now persists in `metrics_json_by_basis.mark_to_market`, and switch the disabled-with-reason gate to ENABLED where that data is present. Where it's genuinely absent, keep disabled-with-reason (honest).
- **MTM-02 composite compose:** confirm/extend that an options-member composite toggles consistently — the composite stitch already computes a dual-basis object + gate (`stitch_composite.py mark_to_market_available()`); verify per-member gaps stay marked (coverage mask), never zero-filled, and the composite toggle composes with the single-key work.
- **MTM-03 regression:** (a) IN-PHASE static byte-identity — every existing non-options / `cash_settlement` factsheet stays byte-identical (golden/parity suites); (b) POST-DEPLOY live Zavara MTM corroboration — a **ship-time human/operational gate**, NOT an in-phase code step (see <deferred>).

NO smoothing (dropped in Phase 101 — the ROADMAP's "where smoothing now works" wording is STALE; ignore it). NO new valuation math — Phase 101 already computes + persists the MTM object; this phase is READ-side wiring + composite compose + regression pinning.
</domain>

<decisions>
## Locked (non-design, from Phase 101 + invariants)
- **Read source:** the factsheet toggle reads `metrics_json_by_basis.mark_to_market` (single-key) — the object Phase 101 persists. Do NOT recompute MTM in the frontend.
- **F-4 gate (LOCKED — carry-forward from Phase 101 red team):** the toggle MUST keep gating the MTM read on `computation_status` (only render MTM for a DONE row) — a failed/insufficient row must never present a live-looking MTM object. Phase 101 made the by-basis write authoritative (stale objects are NULL'd), so the reader is safe, but the computation_status gate is still required.
- **Honest reason mapping (carry-forward):** Phase 101 introduced/kept these single-key MTM degrade reasons that the disabled-with-reason UI must map honestly: `mtm_summary_coverage_incomplete` (crawl coverage hole), `mtm_series_uncomputable` (compute/chain-break), `mtm_second_pass_timeout` (budget). The frontend union (`src/lib/factsheet/types.ts:497`) is OPEN with a graceful `default` (`mtmDisabledReasonCopy`, `basis-context.tsx:100`) — so the copy renders, but Phase 102 should give each an accurate human string.
- **Stale copy to rewrite:** `unsmoothed_options_book` (`stitch_composite.py MTM_REASON_OPTIONS`) still references the DROPPED Phase-83 smoothing concept — its human copy must be rewritten to the honest current meaning (or the reason retired if no longer reachable — research to confirm).
- **SC-4:** every existing non-options / cash_settlement factsheet (single-key AND published composite) stays byte-identical — golden/parity guard.
- **No-invented-data / honest-empty / marked-gaps:** LOCKED. Composite per-member coverage gaps stay MARKED, never zero-filled.
- **Owner-scoped RLS, secretless reads, worker-only decryption:** LOCKED (no secret/api_key/ciphertext surface in any read/projection this phase touches).

## DELEGATED to Fable (planner / UI-SPEC):
- The toggle-enablement UX: how the SegmentedControl presents when MTM is available vs disabled-with-reason for a single-key options strategy; the empty/disabled visual + copy; DESIGN.md conformance.
- The human copy for each MTM reason (`mtm_summary_coverage_incomplete`, `mtm_series_uncomputable`, `mtm_second_pass_timeout`, rewritten `unsmoothed_options_book`) — honest, non-fabricating, aligned with the coverage-mask voice.
- Whether to add a distinct `mtm_anchor_race` reason (Phase 101 deferred-items known-limitation) as part of the reason-copy pass, or leave it self-healing — Fable's call.
- Any read-path/composite-compose detail the research surfaces.
</decisions>

<code_context>
## Existing (research to confirm file:line)
- The factsheet `cash_settlement ↔ mark_to_market` SegmentedControl + the disabled-with-reason gate: `src/lib/factsheet/basis-metrics.ts` (the SC-4 overlay keystone — cash overlay only when a `cash_settlement` key is present), `src/lib/factsheet/types.ts`, `basis-context.tsx` (`mtmDisabledReasonCopy`), and the page/panel that renders the control. Confirm where the gate currently disables for single-key options and what condition to flip.
- The composite read-path (`composite-read-path.ts`) + `stitch_composite.py mark_to_market_available()` gate + the composite dual-basis object — for MTM-02 compose.
- The factsheet consumers that gate the by-basis read on `dqf.composite === true` today (Phase 101 red team noted single-key surfaces never read by-basis yet — `page.tsx:91-120`) — the exact place MTM-01 UI wires the single-key by-basis read in, WITH the computation_status gate.
- The golden/parity byte-identity suites (cash pins) that MTM-03 extends.
- DESIGN.md (MUST read before any visual decision).
</code_context>

<specifics>
- Research MUST confirm: (1) WHERE the single-key factsheet currently reads metrics + where to wire the `metrics_json_by_basis.mark_to_market` read behind the computation_status gate; (2) the exact disabled-with-reason gate condition to flip for a single-key options strategy with MTM data present; (3) whether the composite compose (MTM-02) needs NEW code or is already satisfied by the existing composite dual-basis gate (i.e. is MTM-02 a verify-only + test task, or a build task?); (4) the golden/parity suites for the SC-4 byte-identity regression.
- This is the demo-adjacent honest-MTM story for the options book (Zavara) — the read UI must be honest (real MTM curve, real disabled reasons), never a fabricated line.
</specifics>

<deferred>
## Post-deploy / ship-time (NOT in-phase code)
- **MTM-03 LIVE Zavara MTM corroboration** is a POST-DEPLOY operational gate (OQ-3 from Phase 101): the worker must deploy to Railway, THEN a re-derive backfill (`enqueue_compute_job(strategy_id, 'derive_broker_dailies')` per single-key Deribit options strategy) populates `metrics_json_by_basis.mark_to_market`, THEN verify the Zavara MTM curve corroborates AND cash stays byte-identical (live SC-4). This CANNOT be attested during phase-execute (no data until backfill) — treat as a ship-time human_verification gate, like the SC-3 live-GUI gate in prior milestones. Do NOT claim live MTM attestation at phase close.
- Any NEW options-MTM valuation method or smoothing (permanently dropped).
</deferred>
