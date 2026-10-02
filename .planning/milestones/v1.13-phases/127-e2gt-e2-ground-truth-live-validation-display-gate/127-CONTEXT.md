# Phase 127: E2GT — E2 ground-truth live validation + display gate - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning (thin — mostly-built groundwork)
**Mode:** Auto-generated (autonomous; verification/hardening phase, not a rebuild)

<domain>
## Phase Boundary

The derived allocator curve has its `api_verified` anti-fabrication anchor — it
passes live anchor-consistency on real account data, and a curve is DISPLAYED
only when trustworthy.

**This is a live acceptance run + display-gate PROOF, NOT a rebuild** (roadmap
says so explicitly). The harness + hand-derived oracles + the display gate all
landed as v1.12 123-03 / Phase 115.1 groundwork:
- `analytics-service/scripts/e2_allocator_ground_truth.py` — read-only-scope
  proof + `compute_anchor_consistency` + fail-loud exit codes (0 pass / 2
  fail-loud-scope / 3 skip-missing-env).
- `analytics-service/tests/test_e2_ground_truth_harness.py` — the FLIPRETRY-03
  PASS/FAIL hand-derived anchor pair + untrustworthy/degradation/fail-loud tests.
- `src/lib/queries.ts` `extractTrustworthyDerivedCurve` (~L2455) + the ONE
  producer flip site (~L2591): derived row present AND `is_trustworthy===true`
  AND well-formed dense curve → `equityCurveSource="derived"`; else legacy
  `equitySnapshotsToDailyPoints` byte-unchanged. DATA-DRIVEN, no flag.
</domain>

<decisions>
## Implementation Decisions

### Scope (autonomous — build code, model live op)
- **E2GT-01 (live run) = FOUNDER `human_needed` leg.** `e2_allocator_ground_truth.py`
  runs LIVE with founder-provisioned read-only `E2_GROUND_TRUTH_*` Railway env
  against a real allocator key, and must PASS anchor-consistency. Deliver a
  written runbook step; the run itself is a founder LIVE op (env is a secret,
  read-only exchange key). NEVER claim the live run happened without evidence.
- **E2GT-02/03 (display gate + fail-loud) = BUILDABLE PROOF.** The code exists;
  this phase PROVES it via test coverage. Audit the existing ~10 test refs to
  `extractTrustworthyDerivedCurve`/`equityCurveSource` and add a focused test
  ONLY where a real gap exists for the three criteria: (a) trustworthy+well-formed
  → derived; (b) untrustworthy / absent / malformed → legacy byte-unchanged; (c)
  a failing anchor-consistency FAILS LOUD and blocks the derived display (the
  wrong curve is NEVER shown — no-invented-data invariant). Do NOT add redundant
  tests over already-covered cases.

### Claude's Discretion
Test structure and runbook wording at Claude's discretion, guided by the existing
harness tests + queries.test.ts conventions.
</decisions>

<code_context>
## Existing Code Insights

### Reusable / already-built (prove, don't rebuild)
- `src/lib/queries.ts:2455` `extractTrustworthyDerivedCurve` (null on
  untrustworthy/malformed/absent → legacy) + `:2591` the equityCurveSource flip.
- `analytics-service/scripts/e2_allocator_ground_truth.py` (`compute_anchor_consistency`,
  read-only scope proof, exit codes) + `tests/test_e2_ground_truth_harness.py`.

### Integration points
- The derived display feeds the allocator equity chart + V2 factsheet + composer
  baseline (the ONE producer site). Untrustworthy/absent → legacy unchanged
  (load-bearing until the founder-gated per-key backfill runs — all 517 prod keys
  currently have zero per-key rows).
- Gates Phase 129 (FLIP) and Phase 130 (GOLIVE).

### Conventions
- Fail-loud + no-invented-data. Hand-derived oracles (never the impl's own formula
  as the oracle — money-math invariant).
</code_context>

<specifics>
## Specific Ideas

Audit-then-fill: confirm the three E2GT criteria are each covered by an existing
or new test; write the E2GT-01 founder runbook. Keep it minimal — the groundwork
is already load-bearing and tested.
</specifics>

<deferred>
## Deferred Ideas

The FLIP itself (Phase 129 — prod backfill enqueue). The go-live flag flip
(Phase 130).
</deferred>
