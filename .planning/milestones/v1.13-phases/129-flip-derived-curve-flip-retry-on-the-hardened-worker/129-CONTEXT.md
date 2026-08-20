# Phase 129: FLIP — derived-curve FLIP retry on the hardened worker - Context

**Gathered:** 2026-07-19
**Status:** Ready (thin — verification + a founder live op; groundwork already built)
**Mode:** Auto-generated (autonomous; verification phase, no new build expected)

<domain>
## Phase Boundary

The v1.11-rolled-back derived-allocator-equity flip is re-attempted SAFELY — the
production backfill enqueue runs on the Phase-125 hardened dedicated worker AFTER
Phase-127 E2 validation, completes without wedging, and is trivially rollbackable.

**Depends on:** Phase 125 (hardened dedicated worker — DONE) + Phase 127 (E2
ground-truth green — E2GT-02/03 done; E2GT-01 live run is human_needed). This is
the live retry + safety PROOF, not a rebuild.
</domain>

<decisions>
## Implementation Decisions

### Scope (autonomous — verify built groundwork, model the live op)
- **FLIP-01 (the live enqueue, no wedge) = FOUNDER `human_needed` leg.** The prod
  backfill enqueue re-attempted on the dedicated worker AFTER E2GT passes,
  completing without wedging (healthz never stale past the restart threshold — the
  exact v1.11 failure mode, disproven LIVE). Requires the founder to run the
  cutover + enqueue per the runbook, in order, only after E2 green. NEVER claimed
  done without the live evidence (healthz-fresh-throughout).
- **FLIP-02 (idempotent enqueue + executable rollback) = ALREADY BUILT — VERIFY.**
  `scripts/phase35_backfill_enqueue.py` bails on a re-run when pending api_key
  derive jobs exist ("skipping to avoid duplicates"); `tests/test_phase35_backfill_enqueue.py`
  covers idempotent re-run, pending-skips-enqueue, none-pending-RAISES-not-skips
  (Rule 12 guard), malformed-rows-skipped. Rollback is documented AND executable:
  runbook Step 8 (verbatim v1.11 recovery — delete flip jobs + empty
  `allocator_equity_derived` + unschedule the cron), with abort paths at every step.
- **FLIP-04 (derived curves via the trustworthy gate, data-driven no flag) =
  ALREADY BUILT (Phase 127).** `extractTrustworthyDerivedCurve` + the
  `equityCurveSource` flip site: untrustworthy/absent → legacy render unchanged.

### Claude's Discretion
If the FLIP-02 idempotency or rollback coverage has a genuine gap, add the minimal
test/runbook step. Otherwise record the audit + model FLIP-01 human_needed — do NOT
manufacture work over already-load-bearing, tested groundwork (ponytail).
</decisions>

<code_context>
## Existing Code Insights
- `analytics-service/scripts/phase35_backfill_enqueue.py` (idempotent enqueue) +
  `tests/test_phase35_backfill_enqueue.py` (idempotency suite).
- `analytics-service/services/allocator_equity_derive.py` (the derive follow-on).
- `docs/runbooks/flipretry-derived-equity-go-live.md` — the full FLIP runbook:
  cutover (Steps 0-2, Phase 125), E2 gate (Step 4, two-part exit0+within_tol,
  Phase 127), pilot/full backfill, Step 6 cron reschedule LAST, Step 8 ROLLBACK.
- `src/lib/queries.ts` `extractTrustworthyDerivedCurve` (~L2455) + flip site (~L2591).

### Conventions
- The dedicated worker isolation (Phase 125) is the load-bearing wedge-prevention;
  `wait_for` alone is necessary-not-sufficient. Cron reschedule is dead LAST.
</code_context>

<specifics>
## Specific Ideas
Audit FLIP-02 (idempotency + rollback) + FLIP-04 (display gate) coverage; model
FLIP-01 as the human_needed live enqueue gated on E2 green. Minimal.
</specifics>

<deferred>
## Deferred Ideas
The go-live flag flip + egress whitelist (Phase 130 GOLIVE).
</deferred>
