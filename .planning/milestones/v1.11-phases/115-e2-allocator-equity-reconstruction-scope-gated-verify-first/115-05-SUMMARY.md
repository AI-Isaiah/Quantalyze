---
phase: 115-e2-allocator-equity-reconstruction-scope-gated-verify-first
plan: 05
subsystem: testing
tags: [pytest, pandas, oracle, ccxt, deribit, allocator-equity, verify-first, coverage]

# Dependency graph
requires:
  - phase: 115-03
    provides: the $-equity backward-replay + unified cashflow ledger core (replay_key_equity, allocator_equity_curve, build_allocator_ledger, mwr_and_dietz_from_ledger)
  - phase: 115-01
    provides: frozen shared fixtures (tests/e2_fixtures.py) + the match-score golden + delete-gate lineage
provides:
  - Independent module-free parity oracle over every E2 STITCH claim (internal consistency, blend-vs-backbone, zero-flow equivalence, seam invariance, corruption canary)
  - Committed read-only ground-truth harness (scripts/e2_allocator_ground_truth.py) for the real-account anchor-consistency acceptance run
  - Phase-close gate battery green: full analytics suite + coverage >=80, match golden byte-stable, E1 delete-gate
affects: [115.1-worker-side-display-derivation, scenario-composer-v2, allocator-equity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "114-01/111-01 independent-oracle discipline: every assertion's expected side re-derived inline in the test body with plain pandas/numpy — no import of the module under test or metrics helpers on the expected side"
    - "deribit_ground_truth committed-one-off pattern re-pointed at a new core: env-only creds, read-only scope proven before fetch, single sanitized JSON, non-zero exit on any skip"

key-files:
  created:
    - analytics-service/tests/test_e2_parity_oracle.py
    - analytics-service/scripts/e2_allocator_ground_truth.py
  modified: []

key-decisions:
  - "The E2 golden gate is anchor-consistency + internal-consistency + seam pins + match-score byte-parity — deliberately NOT curve-parity vs the legacy mark-basis store (Landmine L4: mark vs cash makes byte-parity structurally impossible)"
  - "The allocator->key->anchor resolver is Phase-115.1 worker-side code and is NOT duplicated in the harness; the founder supplies members explicitly (strategy_id:anchor_usd), mirroring deribit_acceptance's explicit account descriptors"
  - "Live acceptance run is approval-gated on a founder-provisioned read-only exchange key; absent creds -> exit 3 (pending-founder-env) and the fixture gates carry the phase"

patterns-established:
  - "Fabrication canary (Oracle 5): the oracle helper run against a corrupted module input MUST raise, proving the oracle is RED-capable and not vacuously green"
  - "Additive-only invariant re-proven: no phase-115 source file writes allocator_equity_snapshots and no source file was modified in the phase diff"

requirements-completed: [STITCH-03, STITCH-04, STITCH-05, STITCH-06, BACKBONE-02]

# Metrics
duration: ~35min
completed: 2026-07-17
---

# Phase 115 Plan 05: E2 Independent Parity Oracle + Ground-Truth Harness Summary

**A module-free pandas oracle that re-derives every E2 STITCH claim (and can catch the module lying), plus a committed read-only ground-truth harness for the real-account anchor-consistency run, closing Phase 115 with the full suite, coverage gate, match golden, and E1 delete-gate all green.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-17
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- **Independent parity oracle** (`test_e2_parity_oracle.py`): 5 oracles whose expected side is re-derived INLINE with plain pandas/numpy/stdlib — never by importing `allocator_equity_derive` or a `metrics.py` helper on the expected side (the 114-01/111-01 discipline). Oracles: (1) internal consistency — an inline backward $-replay reproduces the module's per-key equity day-by-day and the forward identity `(equity_t − F_t)/equity_{t-1} − 1 == r_t` holds; (2) blend TWR vs backbone — inline cumprod equals `compute_all_metrics` cumulative return; (3) zero-flow equivalence — inline normalized cumprod equals BOTH the module perf-curve AND the normalized $-curve; (4) seam — inline segment-TWR product equals the cross-seam TWR, inline boundary-jump equals the ledger's synthetic seam entry, and a from-scratch Modified-Dietz agrees with the module scalar; (5) fabrication canary — the oracle raises against a corrupted (one-flow-dropped) module input, proving it is RED-capable.
- **Ground-truth harness** (`scripts/e2_allocator_ground_truth.py`): the `deribit_ground_truth` pattern re-pointed at the E2 cash-basis core — env-only creds, read-only scope PROVEN via `detect_permissions` before any fetch, live equity via the existing exchange helpers, derived terminal via the `allocator_equity_derive` core over service-role `csv_daily_returns` + persisted anchors, and ONE sanitized JSON (`anchor_consistency {derived_terminal, live_equity, drift_pct, within_same_day_tolerance}` + a non-gating old-store-vs-new EVIDENCE block carrying the mark-vs-cash L4 reason). Never writes any table; non-zero exit on any skip/partial.
- **Phase-close gate battery green** (see Verification).

## Task Commits

1. **Task 1: independent parity oracle** — `63632ed6` (test)
2. **Task 2: ground-truth harness + phase gates** — `c999c895` (feat; includes the delete-gate token fix)

_Task 1 is test-only (no source files), so the MVP+TDD behavior-adding gate does not apply — the oracle pins already-landed wave-2/3 code and is green immediately, with Oracle 5 supplying the RED-capability proof._

## Files Created/Modified
- `analytics-service/tests/test_e2_parity_oracle.py` - the independent, module-free oracle over the full fixture scenario (5 oracles + corruption canary)
- `analytics-service/scripts/e2_allocator_ground_truth.py` - committed read-only acceptance script + runbook docstring; live run gated on founder env

## Decisions Made
- **Gate definition (L4):** anchored on anchor-consistency + internal-consistency + seam pins + match-score byte-parity, NOT old-store curve parity (mark-basis vs cash-basis makes that impossible). The old-store divergence is recorded as non-gating EVIDENCE.
- **Anchor sourcing:** the founder supplies each member's persisted terminal-equity anchor explicitly (`--member strategy_id:anchor_usd`), mirroring `deribit_acceptance.py`'s explicit descriptors, rather than duplicating the Phase-115.1 allocator→key→anchor resolver.
- **Sanitization DRY:** the harness reuses `sanitize_evidence` / `assert_sanitized` from `deribit_ground_truth` so it cannot drift from the proven scrub/deny-key contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed the forbidden `compute` + `_twr` token literal from the harness comments**
- **Found during:** Task 2 (final phase gates)
- **Issue:** The harness docstring/comment used the deleted TWR-scalar token as a contiguous literal to describe the additive-only invariant. The E1 delete-gate's whole-tree token walk (`test_e1_delete_gate.py::test_tree_walk_has_no_reentry_of_deleted_tokens`) forbids that token anywhere outside the `EquityCurveBuilder` METHOD exemption, so it went RED.
- **Fix:** Rephrased both occurrences to "legacy TWR-scalar helper" / "legacy TWR helper" — same intent, no forbidden literal.
- **Files modified:** analytics-service/scripts/e2_allocator_ground_truth.py
- **Verification:** delete-gate + match golden + oracle battery re-run: 12 passed; full suite 3727 passed.
- **Committed in:** c999c895 (amended into the Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix is a comment-wording change only; no logic changed. The delete-gate catching it is the gate working as designed. No scope creep.

## Issues Encountered
- None beyond the deviation above.

## Verification

Run in the CI-3.12 venv (`analytics-service/.venv`; local Python 3.14 SIGSEGVs on pandas).

- **Full analytics suite + coverage gate:** `3727 passed, 93 skipped` in 66s; **coverage 89.11%** (>= `--cov-fail-under=80` — gate reached). The 93 skips are the live-DB modules (no local test DB), matching CI's skip behavior.
- **E1 delete-gate:** green (`test_e1_delete_gate.py`).
- **Match-score golden:** byte-stable green (`test_e2_match_score_golden.py`) after all phase edits.
- **Parity oracle:** all 5 oracles green (`test_e2_parity_oracle.py`); the corruption canary confirms RED-capability.
- **Additive-only:** no phase-115 source file writes `allocator_equity_snapshots`; no store/`equity_reconstruction`/TWR-scalar source file was modified in the phase diff.

## User Setup Required

**Approval-gated (pending founder env) — does NOT block the phase.** The LIVE anchor-consistency acceptance run requires a founder-provisioned read-only exchange key set in Railway service variables:
- `E2_GROUND_TRUTH_API_KEY` / `E2_GROUND_TRUTH_API_SECRET` (+ `E2_GROUND_TRUTH_PASSPHRASE` for OKX-family keys)
- Run: `railway ssh "cd /app && python -m scripts.e2_allocator_ground_truth --exchange <venue> --allocator-id <uuid> --member <strategy_uuid>:<anchor_usd> ..."`
- When creds are absent the script exits 3 with an explicit SKIP reason; the Phase-115 fixture gates carry the phase. Live run status: **pending founder env.**

## Next Phase Readiness
- Phase 115 acceptance surface is complete: the fixture oracle pins every STITCH claim independently, the real-account runbook is committed, and nothing regressed.
- Ready for Phase 115.1 (worker-side display derivation) — which is the consumer that will surface the thread-only Dietz/MWR scalars and own the allocator→key→anchor resolver the harness deliberately leaves out.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_e2_parity_oracle.py
- FOUND: analytics-service/scripts/e2_allocator_ground_truth.py
- FOUND: .planning/phases/115-.../115-05-SUMMARY.md
- FOUND commit: 63632ed6 (test — parity oracle)
- FOUND commit: c999c895 (feat — ground-truth harness)

---
*Phase: 115-e2-allocator-equity-reconstruction-scope-gated-verify-first*
*Completed: 2026-07-17*
