---
phase: 115-e2-allocator-equity-reconstruction-scope-gated-verify-first
plan: 03
subsystem: analytics
tags: [python, pandas, allocator, equity-curve, stitch, cashflow-ledger, dietz, mwr, irr, tdd]

# Dependency graph
requires:
  - phase: 115-02
    provides: services/allocator_equity_derive.py blend + segment_coverage/Seam records; frozen e2_fixtures.py (rotated C/D seam pair, ANCHORS)
  - phase: 115-01
    provides: frozen e2_fixtures.py (concurrent A/B, rotated C/D, anchors, real-flow fixtures)
provides:
  - "replay_key_equity: $-equity backward replay from the terminal venue anchor over the return path (equity_{t-1}=(equity_t-F_t)/(1+r_t)) with HIGH-1 flow-day union + forward self-check; anchor=None -> honest degradation"
  - "perf_curve: cashflow-neutral cumulative-return path normalized to 1.0 (STITCH-03 equivalence partner of the $-curve)"
  - "allocator_equity_curve: daily sum over the common anchored window with a degraded flag for dropped (unanchored) keys"
  - "build_allocator_ledger: the ONE ordered provenance-tagged (real|seam) dated cashflow ledger; seam entry = boundary equity jump, known=False when a boundary segment is unanchored"
  - "mwr_and_dietz_from_ledger: first production caller of compute_mwr / compute_modified_dietz — the KEPT cashflow surface the unified backbone cannot reproduce (thread-only)"
affects: ["Phase 115.1 worker-side $-curve display derivation (definite consumer)", 115-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Returns-based backward NAV replay: reuse the nav_twr dated-flow CONVENTION (equity_{t-1}=(equity_t-F_t)/(1+r_t)) on RETURNS (dailies path persists no NAV column) rather than the pnl-based reconstruct_nav — same identity, no un-persisted daily P&L"
    - "ONE unified ledger: windowed stitch + cashflow accounting are one code path — real external flows and synthetic seam jumps share a single provenance-tagged list feeding both the $-replay and the scalar adapters (one construction site, grep-pinned)"
    - "Forward/backward construction self-check mirroring nav_twr.reconcile_flow_residual — reddens only on a roll-vs-identity code divergence, never on an economically-wrong anchor"

key-files:
  created:
    - analytics-service/tests/test_e2_equity_curve_layer.py
    - analytics-service/tests/test_e2_seam_ledger.py
  modified:
    - analytics-service/services/allocator_equity_derive.py

key-decisions:
  - "The $-curve is reconstructed from (returns, flows, anchor) because csv_daily_returns persists NO NAV column — the level is never read from storage; anchor=None yields NO $-series, flagged, never a fabricated base (STITCH-04)"
  - "A rotation-boundary equity jump is a SYNTHETIC deposit/withdrawal through the SAME ledger real flows live in: TWR stays clean across the seam (product of segment TWRs, no injected seam return) while the $-curve steps by exactly the jump (STITCH-06)"
  - "Seam synthetic flows apply ONLY at genuine rotation boundaries (segment_coverage disjoint-set Seams) — NEVER to concurrent-blend days (L1 pin, held by construction: the blend path never emits a seam)"
  - "MWR uses investor-perspective signs (deposit = investment OUT, amount flips to -usd_signed, begin_value prepended as the initial investment); Modified Dietz uses portfolio-perspective signs (amount = usd_signed directly) — the adapter owns the two sign conventions at the call boundary"
  - "compute_mwr / compute_modified_dietz are THREADED and tested but NOT display-wired this phase (RESEARCH OQ3) — Phase 115.1 surfaces them"
  - "Additive only: the module never reads/writes allocator_equity_snapshots, never imports the equity_reconstruction writer arm, and never touches the legacy compute_twr method — delete-gate stays green"

patterns-established:
  - "KeyEquity(equity|None, reason) + AllocatorEquity(equity|None, flags): honest-degradation carriers with machine-token reasons and bool/count flags — no raw USD in any flag/exception (T-115-05)"
  - "LedgerEntry(flow, provenance, known): unknown-magnitude seams flagged known=False -> scalar adapters fail loud (None), never fabricate a jump"
  - "Structural refusals raise NavReconstructionError (imported from nav_twr) with counts/day-indices only — non-positive intermediate equity and <=-100% return factors refuse rather than floor"

requirements-completed: [STITCH-03, STITCH-04, STITCH-05, STITCH-06]

# Metrics
duration: ~35min
completed: 2026-07-17
---

# Phase 115 Plan 03: $-Equity Reconstruction + Unified Cashflow Ledger Summary

**The founder-locked STITCH contract is now executable math: the $-equity curve is reconstructed backward from the terminal venue anchor through the cashflow-neutral return path (STITCH-03/04), real external flows and synthetic rotation-seam jumps share ONE provenance-tagged dated ledger that the KEPT Modified-Dietz/MWR scalars consume (STITCH-05/06), TWR stays clean across every seam while the $-curve steps by exactly the boundary jump, and every missing anchor / unknown seam degrades honestly with no invented data.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 (both TDD, RED→GREEN)
- **Files modified:** 1 module + 2 new test files
- **Tests:** 30 green (12 equity-layer + seam-ledger new, plus blend/delete-gate/match-golden regression)

## Accomplishments

### Task 1 — $-equity backward replay (STITCH-03/04)
- `replay_key_equity(returns, flows, anchor)` rolls the per-key $-equity backward from the terminal anchor using the nav_twr dated-flow identity replayed on RETURNS; unions flow days into the return index first (HIGH-1 mirror — a flow on a no-return day is a valid r=0 equity day, never an orphan); runs a forward/backward construction self-check.
- `perf_curve(returns)` is the cashflow-neutral cumulative-return path normalized to 1.0 — deliberately the exact normalization the $-curve telescopes to under zero flows, so the equivalence pin is byte-clean.
- `allocator_equity_curve` sums anchored per-key curves over their common window, dropping unanchored keys with a `degraded` flag; all-unanchored -> None + honest-empty.
- Refuses structurally (NavReconstructionError, counts/day-indices only) on non-positive reconstructed equity or a ≤−100% return factor — never a fabricated floor, no raw USD leak.

### Task 2 — the ONE unified ledger + Dietz/MWR threading (STITCH-05/06)
- `build_allocator_ledger(real_flows_by_key, seams, per_key_equity)` produces a single ordered provenance-tagged ledger; each rotation Seam becomes ONE synthetic entry dated on the next segment's first day carrying `next_first_day_equity − prev_last_day_equity`; an unanchored boundary flags the entry `known=False` (nan magnitude).
- Every entry funnels through one construction helper (grep-pinned single construction site).
- `mwr_and_dietz_from_ledger` is the first production caller of `compute_mwr` / `compute_modified_dietz`; it fails loud `(None, None)` on any unknown-magnitude seam and converts each `ExternalFlow` into the two dict shapes the KEPT helpers expect (investor-sign IRR vs portfolio-sign Dietz).

## Verification (evidence)

Plan verification command — all green:
```
tests/test_e2_allocator_blend.py tests/test_e2_equity_curve_layer.py \
tests/test_e2_seam_ledger.py tests/test_e2_match_score_golden.py \
tests/test_e1_delete_gate.py  ->  30 passed
```

- **Seam-flow-only-at-rotation (L1) pin HOLDS:** seam entries are emitted solely from the `segment_coverage` disjoint-set Seam list; concurrent-blend days never produce a seam (verified by construction + `test_twr_is_clean_across_the_seam_and_dollar_curve_steps`, which shows the combined TWR equals the product of segment TWRs with no seam return term).
- **Real+synthetic ledger parity result:** the unified ledger (real +10000 deposit + synthetic seam jump) threads through both scalars to finite values that byte-match `compute_mwr` / `compute_modified_dietz` called on the same adapter-converted dict shapes (`test_unified_ledger_threads_dietz_and_mwr`), and the seam magnitude equals the C→D boundary equity jump exactly (`test_seam_entry_magnitude_is_the_boundary_equity_jump`).
- **Delete-gate green:** no `compute_twr` / `_compute_sharpe_and_vol` token in the new module or tests; no line pairs `portfolio_metrics` with the twr token; the module is strictly additive (no `allocator_equity_snapshots` / writer-arm / method touch).

## Deviations from Plan

**1. [Rule 1 - Bug] Guard test fixture used a withdrawal instead of a deposit**
- **Found during:** Task 1 GREEN.
- **Issue:** The initial RED test drove non-positive intermediate equity with a large *withdrawal*; on the backward roll a withdrawal *inflates* prior equity (`equity_{t-1}=(equity_t−F_t)/(1+r)` with F<0), so it never refuses. A large *deposit* is what forces `(equity_t − F_t) ≤ 0`.
- **Fix:** Flipped the guard fixture to a dwarfing deposit; the structural refusal then fires as intended.
- **Files modified:** analytics-service/tests/test_e2_equity_curve_layer.py
- **Commit:** 92c53773 (folded into the Task-1 GREEN commit with the implementation)

**2. [Rule 3 - Blocking] `mwr_and_dietz_from_ledger` needs a period origin**
- **Issue:** Modified Dietz requires a 0-based day index per flow, which is undefined without a period start; the plan's action text sketched a 4-arg adapter.
- **Fix:** Added a keyword-only `period_start` (ISO) alongside `period_days`; the adapter derives the terminal date from `period_start + period_days` for the MWR terminal inflow. Documented in the docstring. No functional scope change — still thread-only, still delegates to the KEPT helpers.
- **Files modified:** analytics-service/services/allocator_equity_derive.py

## Known Stubs

None. The pure core is fully implemented and tested. The plan deliberately scopes the *read path* (fetching real flows from production) to Phase 115.1 — this is documented in the objective, not a stub: the fixture tests exercise the real+synthetic ledger arm completely.

## Threat Flags

None. Pure functions, fixture data only; no new network endpoints, auth paths, or trust boundaries. T-115-05 (no raw USD in exceptions/flags) is honored and asserted by `test_non_positive_intermediate_equity_refuses_without_leaking_usd`.

## Commits

- `a4e6e4c0` test(115-03): failing pins for $-equity backward replay (STITCH-03/04)
- `92c53773` feat(115-03): $-equity backward replay layer (STITCH-03/04)
- `35074d28` test(115-03): failing pins for the ONE unified ledger (STITCH-05/06)
- `229dd0e5` feat(115-03): ONE unified cashflow ledger + Dietz/MWR threading (STITCH-05/06)

## Self-Check: PASSED

All created files exist on disk; all four per-task commits resolve in git log.
