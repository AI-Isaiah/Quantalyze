---
phase: 127-e2gt-e2-ground-truth-live-validation-display-gate
plan: 01
subsystem: testing
tags: [allocator-equity, anchor-consistency, display-gate, fail-loud, runbook, e2-ground-truth]

# Dependency graph
requires:
  - phase: 123 (v1.12 123-03 / Phase 115.1)
    provides: e2_allocator_ground_truth.py harness + hand-derived anchor oracles + extractTrustworthyDerivedCurve display gate
  - phase: 125-04
    provides: docs/runbooks/flipretry-derived-equity-go-live.md (Steps 0-8)
provides:
  - Coverage audit mapping the 3 E2GT criteria to existing tests (all covered — no rebuild)
  - E2GT-01 founder LIVE-op runbook step (Step 4) with accurate two-part gate (exit 0 AND within_same_day_tolerance===true)
  - Corrected the runbook's exit-code framing so a drift-beyond-band divergence (exit 0, verdict in JSON) can no longer slip the FLIP gate
affects: [phase-129-flip, phase-130-golive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Audit-then-fill: prove existing coverage before adding a test; add none when the gap is closed"
    - "Two-part live gate: exit code (run completed) AND the anchor_consistency.within_same_day_tolerance JSON field (the verdict)"

key-files:
  created:
    - .planning/phases/127-e2gt-e2-ground-truth-live-validation-display-gate/127-SUMMARY.md
  modified:
    - docs/runbooks/flipretry-derived-equity-go-live.md

key-decisions:
  - "All 3 E2GT criteria already covered by v1.12 123-03 fixtures — added NO new test (minimal, ponytail)"
  - "The E2 gate is exit 0 AND within_same_day_tolerance===true, NOT exit 0 alone — a drift-beyond-band divergence exits 0 with the verdict in the JSON evidence field"
  - "E2GT-01 (live run) stays human_needed / OPEN — never claimed done without the exit-0 + within_same_day_tolerance===true evidence JSON"

patterns-established:
  - "Live acceptance gate: the founder reads the sanitized evidence JSON verdict field, not just the process exit code"

requirements-completed: [E2GT-02]

# Metrics
duration: 18min
completed: 2026-07-19
---

# Phase 127: E2GT — E2 Ground-Truth Live Validation + Display Gate Summary

**Audited the derived-curve display gate: all 3 E2GT criteria already proven by v1.12 123-03 fixtures (no new test), and sharpened the runbook's E2GT-01 live-acceptance step so the FLIP gate reads the anchor verdict from the evidence JSON, not the exit code alone.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-19
- **Completed:** 2026-07-19
- **Tasks:** 2 (1 audit-only, 1 runbook edit)
- **Files modified:** 1 tracked (`docs/runbooks/flipretry-derived-equity-go-live.md`) + this SUMMARY

## Accomplishments

- **Coverage audit (E2GT-02 / criterion 3):** mapped all three display-gate criteria to existing tests — every one is already covered, so NO redundant test was added (verification/hardening phase, not a rebuild).
- **E2GT-01 runbook step:** rewrote Step 4 of `flipretry-derived-equity-go-live.md` into a precise founder LIVE-op with the exact env contract, CLI, and exit-code + JSON-field interpretation.
- **Fail-loud correction:** the runbook previously implied "exit 0 ⇒ pass" and framed a live-vs-derived divergence as a non-zero exit. The harness actually returns **exit 0** for a drift-beyond-band run and surfaces the verdict in `anchor_consistency.within_same_day_tolerance`. Following the old wording blindly could have pushed a drifted curve live. The gate is now documented as the two-part conjunction.

## Coverage Audit (the deliverable)

The three E2GT display-gate criteria and where each is proven. **All covered — no new test written.**

### (a) trustworthy + well-formed dense curve → `equityCurveSource="derived"`

| Test | File | Level |
|------|------|-------|
| `PASS: a trustworthy well-formed curve renders 'derived' and maps the payload directly` | `src/lib/queries.test.ts` (FLIPRETRY-03 describe) | unit — the ONE producer site (`derivePhase07Fields`) |
| `RED (plan 05): a trustworthy derived row repoints equityDailyPoints onto the curve … marks the source 'derived'` | `src/lib/queries.my-allocation.test.ts` (115.1 equity display-repoint) | integration — through `getMyAllocationDashboard` |

**COVERED.** Both feed a dense curve mapped DIRECTLY (no forward-fill adapter) and assert `derived`.

### (b) untrustworthy / absent / malformed / empty → returns null → legacy render, `equityCurveSource="legacy"`, byte-unchanged

| Test | File |
|------|------|
| `FAIL: the BYTE-IDENTICAL curve with is_trustworthy=false renders 'legacy' …` | `src/lib/queries.test.ts` |
| `SAFETY (never redden): no derived row → equityDailyPoints byte-identical to legacy` (absent row) | `src/lib/queries.my-allocation.test.ts` |
| `RED (plan 05): an untrustworthy derived row falls back to legacy …` | `src/lib/queries.my-allocation.test.ts` |
| `MALFORMED (T-115.1-18): curve is NOT an array → legacy (no crash)` | `src/lib/queries.my-allocation.test.ts` |
| `MALFORMED (T-115.1-18): non-finite equity_usd → legacy (never NaN)` | `src/lib/queries.my-allocation.test.ts` |
| `B2 (empty curve): curve [] → legacy (never a blank chart labeled 'derived')` | `src/lib/queries.my-allocation.test.ts` |
| `MALFORMED (T-115.1-18): is_trustworthy present-but-non-boolean → legacy` | `src/lib/queries.my-allocation.test.ts` |
| `MALFORMED (T-115.1-18): missing date/equity_usd, non-object point, empty/malformed date → null` | `src/lib/queries.my-allocation.test.ts` |

**COVERED (8 cases).** The neuter-proof spine is the FAIL/PASS pair on a **byte-identical** curve differing only in `is_trustworthy` — deleting the `is_trustworthy !== true` guard flips the FAIL case to `derived`.

### (c) a failing anchor-consistency FAILS LOUD and blocks the derived display — the wrong curve is NEVER shown

Harness verdict side (`analytics-service/tests/test_e2_ground_truth_harness.py`):

| Test | Proves |
|------|--------|
| `test_e2_gate_pass_fixture_within_band_is_a_clean_reconcile` | +1.5% drift (hand-derived) inside 2% band → `within_same_day_tolerance=True` (E2 exit-0 PASS condition) |
| `test_e2_gate_fail_on_drift_beyond_band_is_not_a_clean_reconcile` | +5% drift (hand-derived) > 2% band → `within_same_day_tolerance=False` (neuter-proofs the drift conjunct) |
| `test_e2_gate_fail_on_blocking_degradation_even_at_zero_drift` | zero drift but `trustworthy=False` → `within_same_day_tolerance=False` (neuter-proofs the trustworthy conjunct) |
| `test_non_positive_derived_terminal_still_fails_loud` | non-positive derived terminal → `GroundTruthSkip` (exit 3) |
| `test_untrustworthy_curve_within_tolerance_is_not_a_clean_reconcile` | blocking degradation within band still fails |

Display side (the wrong curve is never rendered) = the untrustworthy→legacy gate proven in criterion (b).

**COVERED.** Every expected value is hand-derived in the test (P115 independence — the impl's own formula is never the oracle), and both conjuncts of `within_same_day_tolerance = (drift-in-band AND trustworthy)` are neuter-proofed.

**Conclusion:** all three criteria are already covered. Per the plan's ponytail rule (fewest tests that close the gap), **no test was added.** The display gate is not broken — it behaves exactly as the criteria require.

## Task Commits

1. **Task 1: coverage audit** — no code change (all criteria pre-covered); recorded in this SUMMARY.
2. **Task 2: E2GT-01 runbook step** — see docs commit below (`docs`).

**Plan metadata:** see final commit.

## Files Created/Modified

- `docs/runbooks/flipretry-derived-equity-go-live.md` — Step 4 rewritten into the E2GT-01 founder LIVE-op: read-only `E2_GROUND_TRUTH_API_KEY/_SECRET/_PASSPHRASE` Railway env contract, the `python -m scripts.e2_allocator_ground_truth --member <strategy_id>:<anchor_usd>` CLI, an exit-code table (0=completed+read the JSON field / 2=fail-loud scope breach / 3=skip / 1=other), the two-part gate (exit 0 AND `within_same_day_tolerance===true`), the read-only/never-writes-a-table emphasis, and the "gate green unblocks Step 5 + Phase 129 FLIP + Phase 130 GOLIVE" linkage. The staged-gate bullets and Step 5 reference were made consistent with the two-part gate.

## Decisions Made

- **No new test.** All three criteria are covered by the v1.12 123-03 fixtures; adding tests would be redundant (Rule 2 / DESIGN minimalism). The audit record is the deliverable for E2GT-02/criterion-3.
- **The E2 gate is a two-part conjunction, not exit-0-alone.** The harness (`main()`) returns 0 whenever the run completes and prints evidence; the anchor PASS/FAIL verdict lives in `anchor_consistency.within_same_day_tolerance`. Only scope breach (2), skip (3), and other errors (1) are non-zero. The runbook now directs the founder to read the JSON field. This matches the harness's own in-code RUNBOOK docstring ("read `anchor_consistency.within_same_day_tolerance`").
- **E2GT-01 is `human_needed`.** The live run needs founder-provisioned read-only exchange creds against a real account; running it here would exit 3 (no creds). It is modeled as an open founder LIVE op and is NOT claimed done — it requires exit-0 + `within_same_day_tolerance===true` evidence before the Phase 129 FLIP.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Runbook Step 4 mis-described the E2 gate as exit-0-only**
- **Found during:** Task 2 (runbook extension) — while matching the harness's actual CLI/env/exit contract, the existing Step 4 asserted "REQUIRE exit 0" and "A non-zero, non-skip exit is a material live-vs-derived divergence." The code does NOT do this: a drift-beyond-band divergence returns **exit 0** with `within_same_day_tolerance=False` in the JSON. Following the old wording, a founder could see exit 0 and proceed to the FLIP with a drifted curve.
- **Fix:** Rewrote Step 4 (and the staged-gate bullets + the Step 5 / ordering references) to state the two-part gate: exit 0 AND `anchor_consistency.within_same_day_tolerance === true`. Added an exit-code table clarifying exit 0 = "run completed, read the field", with an explicit ⚠️ that exit 0 does NOT imply the anchor passed.
- **Files modified:** `docs/runbooks/flipretry-derived-equity-go-live.md`
- **Verification:** Cross-checked against `scripts/e2_allocator_ground_truth.py` `main()` (returns 0 after printing evidence; only ScopeViolationError→2, GroundTruthSkip→3, other→1) and its in-code RUNBOOK docstring (step 4: "read `anchor_consistency.within_same_day_tolerance`"). Documentation-only change; no code path altered.
- **Committed in:** the `docs` runbook commit.

---

**Total deviations:** 1 (Rule 1 — a fail-loud documentation-accuracy fix; not a code change).
**Impact on plan:** Strictly within Task 2's scope (extend the runbook). No scope creep — it makes the delivered E2GT-01 step correct rather than misleading, which is the whole point of a go-live gate. No source code touched, so no tsc/lint/pytest gate applies.

## Issues Encountered

- The runbook already carried a Step 4 ("LIVE E2 ground-truth gate") from 125-04, but its gate framing was imprecise (see Deviation 1). Resolved by rewriting it to the two-part gate rather than duplicating a new step. This is the root-cause-honest fix (the gate signal already exists and is correct in code; only the operator instructions were wrong).

## User Setup Required

**E2GT-01 is a founder LIVE op (human_needed) — NOT performed here.**
- Provision a **read-only** exchange key for the allocator account and set `E2_GROUND_TRUTH_API_KEY` / `E2_GROUND_TRUTH_API_SECRET` (+ `E2_GROUND_TRUTH_PASSPHRASE` for OKX-family) on the Railway worker service (rotate after the run).
- Run `python -m scripts.e2_allocator_ground_truth --exchange <venue> --allocator-id <uuid> --member <strategy_id>:<anchor_usd> …` from the worker's egress; redirect stdout to an evidence JSON.
- **Gate green = exit 0 AND `anchor_consistency.within_same_day_tolerance === true`.** Only then does the Phase 129 FLIP / Phase 130 GOLIVE unblock. See `docs/runbooks/flipretry-derived-equity-go-live.md` Step 4.

## Next Phase Readiness

- **E2GT-02:** SATISFIED — the display gate is proven by existing tests (audit above). Requirement can be marked complete.
- **E2GT-01:** OPEN (`human_needed`) — the live acceptance run is a founder op; the runbook step is delivered and precise. Phase 129 (FLIP) and Phase 130 (GOLIVE) remain gated on the exit-0 + `within_same_day_tolerance===true` evidence.
- No blockers introduced. The derived display gate is unchanged and load-bearing on legacy until the founder-gated backfill runs.

## Self-Check: PASSED

- FOUND: `.planning/phases/127-.../127-SUMMARY.md`
- FOUND: commit `0e2c047b` (runbook Step 4 two-part gate)
- FOUND: `within_same_day_tolerance` referenced 8× in the runbook (gate wording landed)

---
*Phase: 127-e2gt-e2-ground-truth-live-validation-display-gate*
*Completed: 2026-07-19*
