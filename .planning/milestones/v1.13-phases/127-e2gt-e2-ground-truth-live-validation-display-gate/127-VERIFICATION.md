---
phase: 127-e2gt-e2-ground-truth-live-validation-display-gate
verified: 2026-07-19T21:20:00Z
status: human_needed
score: 2/3 must-haves verified (1 human_needed — E2GT-01 live run)
overrides_applied: 0
human_verification:
  - test: "Run e2_allocator_ground_truth.py LIVE against a real read-only allocator exchange key with E2_GROUND_TRUTH_* env provisioned on the Railway worker."
    expected: "Exit 0 AND anchor_consistency.within_same_day_tolerance === true in the emitted evidence JSON."
    why_human: "E2GT-01 requires founder-provisioned read-only exchange creds against a real live account; cannot be run in CI or by the verifier (returns exit 3 with no creds). It is a founder LIVE op that gates Phase 129 (FLIP) and Phase 130 (GOLIVE)."
---

# Phase 127: E2GT — E2 Ground-Truth Live Validation + Display Gate Verification Report

**Phase Goal:** The derived allocator curve has its `api_verified` anti-fabrication anchor — it passes live anchor-consistency on real account data, and a curve is DISPLAYED only when trustworthy.
**Verified:** 2026-07-19T21:20:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

This is a verification/hardening phase. The harness, display gate, and hand-derived oracles all pre-existed from v1.12 123-03 / Phase 115.1. The executor added NO new source/tests (audit claimed all 3 criteria already covered) and rewrote the runbook's E2 step. **The coverage claim was independently verified below — not trusted.**

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (E2GT-01) `e2_allocator_ground_truth.py` runs LIVE with `E2_GROUND_TRUTH_*` env and PASSES anchor-consistency on real account data | ? HUMAN_NEEDED | Founder LIVE op — read-only exchange creds + real account. Verifier run would exit 3 (no creds). Runbook Step 4 delivers the precise two-part gate. Legitimate open leg, NOT a gap. |
| 2 | (E2GT-02) Display gate flips `equityCurveSource` to derived ONLY for a trustworthy curve; untrustworthy/absent leaves legacy render byte-unchanged, proven by test | ✓ VERIFIED | `extractTrustworthyDerivedCurve` (queries.ts:2455) + flip site (:2581-2594); 116 TS tests pass incl. FLIPRETRY-03 byte-identical PASS/FAIL pair + 8-case malformed block |
| 3 | (criterion c) A failing anchor-consistency FAILS LOUD and blocks the derived display — the wrong curve is never shown | ✓ VERIFIED | `compute_anchor_consistency` (py:144) verdict = drift-in-band AND trustworthy; non-positive terminal → GroundTruthSkip; 5 pytest neuter-proofs pass; display block via untrustworthy→legacy gate (truth 2) |

**Score:** 2/3 truths verified, 1 human_needed (E2GT-01 live run)

### Adversarial Checks (from verification notes)

| # | Check | Result |
|---|-------|--------|
| 1 | Does the gate flip derived ONLY for trustworthy — not on a truthy-but-malformed payload? | PASS. `extractTrustworthyDerivedCurve` returns null unless `is_trustworthy === true` (strict `!== true` catches false/missing/non-boolean `"true"` string — proven by the "present-but-non-boolean → legacy" test), curve is an array, every point has a strict `YYYY-MM-DD` date + finite `equity_usd`, and the curve is non-empty. |
| 2 | Is untrustworthy/absent/malformed → legacy byte-unchanged (no NaN, no SSR crash)? | PASS. `equityDailyPoints = derivedCurve ?? equitySnapshotsToDailyPoints(...)` — the legacy call is the exact same code path as before. Finite-number guard prevents NaN; object/array guards prevent SSR crash. Tests: "byte-identical", "never NaN", "no crash", empty-curve. |
| 3 | Does a failing anchor-consistency genuinely block the derived display? | PASS. Harness `within_same_day_tolerance = bool(within_tol and trustworthy)` (both conjuncts neuter-proofed); non-positive derived terminal raises `GroundTruthSkip` (fail-loud). `compute_anchor_consistency` is wired into `run()` at py:394 with the real `trustworthy` flag. Display side blocks via the untrustworthy→legacy gate (truth 2). |
| 4 | Is the runbook two-part gate accurate vs the harness `main()` exit-code semantics? | PASS. `main()` returns 0 after printing evidence (even on drift-beyond-band); 2=ScopeViolationError, 3=GroundTruthSkip, 1=other. The runbook exit-code table (Step 4, lines 121-126) matches EXACTLY, and correctly states "exit 0 does NOT imply the anchor passed — read `within_same_day_tolerance`". The executor's deviation fix (exit-0-only → two-part) is accurate, not a new error. |
| 5 | Are the money oracles hand-derived (not the impl's own formula)? | PASS. `drift = (10150-10000)/10000 = +0.015` and `(10500-10000)/10000 = +0.05` computed by hand in the test; both `within_same_day_tolerance` conjuncts (drift-in-band, trustworthy) are separately neuter-proofed. Satisfies the P115 money-math invariant. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/queries.ts` (`extractTrustworthyDerivedCurve` ~L2455, flip ~L2581) | Trust gate + data-driven source flip | ✓ VERIFIED | Strict guards; `derivedCurve ?? legacy`; source = `derivedCurve !== null ? "derived" : "legacy"`. Wired at the ONE producer site (`derivePhase07Fields`). |
| `src/lib/queries.test.ts` | FLIPRETRY-03 byte-identical PASS/FAIL pair | ✓ VERIFIED | PASS→derived, FAIL(is_trustworthy=false)→legacy on a byte-identical curve; deleting the guard flips FAIL to derived. |
| `src/lib/queries.my-allocation.test.ts` | Integration: derived + 8-case legacy-fallback block | ✓ VERIFIED | absent/untrustworthy/non-array/non-finite/empty/non-boolean/missing-field → legacy, all through `getMyAllocationDashboard`. |
| `analytics-service/scripts/e2_allocator_ground_truth.py` | fail-loud verdict + exit codes | ✓ VERIFIED | `compute_anchor_consistency` two-conjunct verdict; exit 0/2/3/1; wired into `run()`. |
| `analytics-service/tests/test_e2_ground_truth_harness.py` | hand-derived anchor oracles + neuter-proofs | ✓ VERIFIED | 5 tests pass; drift figures hand-computed; both conjuncts neuter-proofed. |
| `docs/runbooks/flipretry-derived-equity-go-live.md` (Step 4) | E2GT-01 two-part gate | ✓ VERIFIED | Exit-code table matches harness; two-part gate (exit 0 AND `within_same_day_tolerance===true`) accurate; no debt markers. Commit `0e2c047b`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Display-gate TS suites green | `npx vitest run src/lib/queries.my-allocation.test.ts src/lib/queries.test.ts` | 2 files, 116 tests passed | ✓ PASS |
| Harness fail-loud oracles green | `.venv/bin/python -m pytest tests/test_e2_ground_truth_harness.py -q` | 5 passed | ✓ PASS |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes declared for this phase; the phase's runnable proof is the two test suites above (both executed and green). N/A.

### Requirements Coverage

| Requirement | Source | Description | Status | Evidence |
|-------------|--------|-------------|--------|----------|
| E2GT-01 | ROADMAP / REQUIREMENTS.md:40 | Harness runs LIVE with `E2_GROUND_TRUTH_*` and passes anchor-consistency on real account data | ? NEEDS HUMAN | Founder LIVE op; runbook Step 4 delivered + precise. Correctly OPEN. |
| E2GT-02 | ROADMAP / REQUIREMENTS.md:41 | Derived curve displayed ONLY after passing anchor-consistency; else legacy unchanged, proven by test | ✓ SATISFIED | Code + 116 TS tests (truths 2 & 3). |

Note: ROADMAP success criterion 3 (fail-loud blocks derived display) is verified as truth 3, covered under the E2GT-02 audit; REQUIREMENTS.md tracks two IDs (E2GT-01/02) plus criterion 3 as an SC.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | none | — | No debt markers (TBD/FIXME/XXX) in the one modified file (docs runbook). No source code changed this phase. |

### Human Verification Required

#### 1. E2GT-01 live acceptance run (founder LIVE op)

**Test:** Provision a read-only exchange key for the allocator account; set `E2_GROUND_TRUTH_API_KEY` / `E2_GROUND_TRUTH_API_SECRET` (+ `E2_GROUND_TRUTH_PASSPHRASE` for OKX-family) on the Railway worker; run `python -m scripts.e2_allocator_ground_truth --exchange <venue> --allocator-id <uuid> --member <strategy_id>:<anchor_usd>` from the worker's egress, redirecting stdout to an evidence JSON. Rotate the key after.
**Expected:** Exit 0 AND `anchor_consistency.within_same_day_tolerance === true` in the emitted JSON.
**Why human:** Requires founder-provisioned read-only live exchange creds against a real account; cannot be run in CI or by the verifier (exit 3 with no creds). Gates Phase 129 (FLIP) and Phase 130 (GOLIVE). Per ROADMAP, this is a `human_needed` leg modeled inside the phase and must never be claimed done without the exit-0 + `within_same_day_tolerance===true` evidence JSON.

### Gaps Summary

No gaps. All buildable/testable criteria (E2GT-02 display gate + criterion-3 fail-loud) are independently verified against the actual code and passing test suites — the executor's "already covered, no new test" audit claim holds up. The runbook's two-part-gate deviation fix is accurate against the harness `main()` exit semantics, not a new error. The single open item — E2GT-01, the live acceptance run — is a legitimate founder LIVE op correctly modeled as `human_needed`, NOT a gap. Overall status is therefore `human_needed`.

---

_Verified: 2026-07-19T21:20:00Z_
_Verifier: Claude (gsd-verifier)_
