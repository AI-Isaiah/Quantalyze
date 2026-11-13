# Phase 203: B3TRUNC — why book b3 carries window_truncated - Context

**Gathered:** 2026-11-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Find why book b3 carries `window_truncated`, using Phase 202's evidence, and fix it if it is a defect. This is the `window_truncated` half of RESID-02 (REQUIREMENTS maps RESID-02 to Phase 202 and Phase 203; 202 closed the `out_of_window_flow` half). It is not a re-run of 202's attribution, and 202's numbers (D-15 record) stand.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** If the cause is a defect, 203 FIXES it in code, with a test that goes RED on today's behaviour, and the evidence that b3 no longer carries the flag after the next derive. If the cause is intended behaviour, 203 records the explanation and the evidence, and b3's flag is documented as expected. Either way RESID-02 closes with 203. (Founder 2026-11-07: "Fix it in 203".)
- **D-02:** If the fix needs b3's stored rows re-derived on PROD, 203 may do it ONLY through the product's own derive/recompute path, never with hand SQL. Run the marker query first, take a read-only before/after capture, and report what was written. Rows are not deleted beyond what the derive itself does. (Founder: "Yes, via the product's path, then report".) — **Reversibility:** costly — a derive rewrites stored rows; the before capture is the record.
- **D-03 (standing rules):** PROD reads only through the Supabase MCP, marker query first, one read-only query per call, never a shell DB client or the Keychain. Railway: list operations only, no redeploys. A revoked key affects only itself (the revoked-key-scope rule). An unknown-account key with no venue_account_id is excluded by default (`departed_history_inclusion`, founder-confirmed 2025-09-25).

### Claude's Discretion
- Investigation method and the order of hypotheses, starting from 202's evidence.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/phases/202-*/202-REPORT.md`, `202-03-SUMMARY.md`, `202-07-SUMMARY.md`, `202-CONTEXT.md` D-14..D-17 — the input evidence
- `.planning/ROADMAP.md` § "Phase 203: B3TRUNC"; `.planning/REQUIREMENTS.md` RESID-02
- `analytics-service/services/job_worker.py` (derive, `departed_history_inclusion` ~:15504) — re-locate by symbol
- `TODOS.md` `202-MT5-CLOCK-LEAD-01`, `202-KIT-RESIDUALS-01` (adjacent, not in scope unless the cause runs through them)

</canonical_refs>

<code_context>
## Existing Code Insights

- 202's capture kit lived outside the repo (scratch); the planner re-derives anything it needs from 202's committed records.

</code_context>

<specifics>
## Specific Ideas

None beyond the decisions.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 203-b3trunc*
*Context gathered: 2026-11-07*
