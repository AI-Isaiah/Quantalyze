---
phase: 115-e2-allocator-equity-reconstruction-scope-gated-verify-first
plan: 02
subsystem: analytics
tags: [python, pandas, allocator, blend, stitch, coverage-segmentation, tdd]

# Dependency graph
requires:
  - phase: 115-01
    provides: frozen e2_fixtures.py (concurrent A/B pair, rotated C/D seam pair, make_per_key_returns) + window_overlap_convention.json
provides:
  - "services/allocator_equity_derive.py — canonical Python allocator blend (STITCH-01) + coverage segmentation with STITCH-06 seam contract"
  - "blend_concurrent_returns: capital-weighted D1/D2/D3 blend (static equity weights, 0-fill missing days over constant divisor, all-or-nothing honest-empty gate)"
  - "eligible_key_predicate: phase35-parity eligibility filter reusable by the 115.1 display derivation"
  - "segment_coverage: concurrent-block vs sequential-leg segmentation + ordered Seam list for wave-3 synthetic-flow attachment"
affects: [115-03, 115-05, "Phase 115.1 worker-side display derivation"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure I/O-free derivation core (pandas + stdlib only) — callers inject series/weights; no supabase/network/filesystem"
    - "Cross-language semantic port: Python owns the canonical blend; queries.ts liveBaselineMetricsFromPerKeyDailies is the display-era precedent (cited by line)"

key-files:
  created:
    - analytics-service/services/allocator_equity_derive.py
    - analytics-service/tests/test_e2_allocator_blend.py
  modified: []

key-decisions:
  - "Concurrent sibling keys compose via the capital-weighted BLEND, never stitch_composite.assert_windows_disjoint (Landmine L1) — the blend path never imports/reaches the overlap-raising guard"
  - "Partially-missing interior days 0-fill in the numerator only over a CONSTANT total-weight divisor, replicating scenario.ts L407-430 exactly"
  - "A seam is emitted only on a DISJOINT covering-key-set rotation (zero shared coverage day); partial-overlap transitions (single→concurrent→single) share a key and carry no seam"
  - "STITCH-02 store retirement stays DEFERRED (census did not clear); this module is strictly ADDITIVE and never touches allocator_equity_snapshots (Pitfall 5)"

patterns-established:
  - "Seam record = the STITCH-06 handoff contract: (prev_key, prev_last_day, next_key, next_first_day, gap_days) — WHERE synthetic flows attach, no equity math"
  - "windows_overlap reused (not re-derived) for the rotation non-overlap check; gap days marked absent, never zero-filled (no-invented-data)"

requirements-completed: [STITCH-01]

# Metrics
duration: ~20min
completed: 2026-07-17
---

# Phase 115 Plan 02: Canonical Allocator Blend + Coverage Segmentation Summary

**Python now owns the canonical capital-weighted allocator blend (STITCH-01) — a pure, D1/D2/D3-faithful port of the Phase-36 TS precedent — plus a coverage segmenter that emits the STITCH-06 seam contract wave-3 attaches synthetic flows to, with the L1 concurrent-blend-vs-disjoint-stitch boundary pinned by regression.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 (both TDD, RED→GREEN)
- **Files created:** 2

## Accomplishments
- `blend_concurrent_returns` mirrors `liveBaselineMetricsFromPerKeyDailies` (queries.ts L2135-2256): static current-equity-share weights (D1), curve-shape-only (D2), all-or-nothing honest-empty degrade (D3), negative-equity clamp + all-zero equal-weight fallback (no ZeroDivision), sole-key weight-1.0 passthrough.
- `segment_coverage` distinguishes concurrent blocks (blend applies) from genuine sequential legs, and emits an ordered `Seam` list only on disjoint-covering-set rotations — the STITCH-06 handoff wave 3 consumes.
- Landmine L1 pinned: the blend path never reaches `assert_windows_disjoint` (monkeypatched to explode), so overlapping siblings blend and never raise `CompositeOverlapError`.
- Module is strictly additive and I/O-free: no supabase/db import, no `allocator_equity_snapshots` contact, no `compute_twr`/`portfolio_metrics` tokens (delete-gate clean).

## Task Commits

1. **Task 1 RED: failing blend tests** - `49130d46` (test)
2. **Task 1 GREEN: capital-weighted blend + eligibility** - `f859cff3` (feat)
3. **Task 2 RED: failing segmentation tests** - `2473569d` (test)
4. **Task 2 GREEN: coverage segmentation + seam contract** - `542299b9` (feat)

## Files Created/Modified
- `analytics-service/services/allocator_equity_derive.py` (317 lines) — pure blend + segmentation core; docstring carries the STITCH-02 deferral pointer, residual readers R1/R2/R3-partial/R5/R6, the never-write-`allocator_equity_snapshots` invariant, and the queries.ts/scenario.ts line cites for the partially-missing-day choice.
- `analytics-service/tests/test_e2_allocator_blend.py` — 10 tests (blend D1/D2/D3, L1 regression, static-weight invariance, equal-weight degrade, eligibility parity; segmentation concurrent/adjacent-rotation/partial-overlap/gap-rotation).

## Verification

```
cd analytics-service && python -m pytest tests/test_e2_allocator_blend.py \
  tests/test_e2_match_score_golden.py tests/test_e1_delete_gate.py -q
→ 17 passed
```

- **L1 concurrent-blend-vs-seam regression** (`test_l1_blend_never_touches_disjoint_overlap_guard`): **PASS** — the blend on fully-overlapping keys completes without raising `CompositeOverlapError` and without calling `assert_windows_disjoint`.
- Match golden byte-stable; E1 delete-gate green.

## Deviations from Plan

None — plan executed exactly as written. Both TDD tasks proved RED before GREEN.

## Known Stubs

None. All delivered functions are fully wired and tested; the $-ledger consumption (STITCH-03/04) and worker-side display derivation are explicitly the next-plan scope (115-03 / Phase 115.1), documented in the module docstring.

## Self-Check: PASSED

All created files present; all 4 task commits (49130d46, f859cff3, 2473569d, 542299b9) exist in history. `.planning/` is gitignored/local and intentionally not staged.
