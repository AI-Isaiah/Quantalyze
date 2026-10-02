---
phase: 92-composite-metric-blow-up-annualization-honesty
plan: 01
subsystem: testing
tags: [pytest, native-nav, chain-linked-twr, deribit-inverse, repro-fixture, xfail]

# Dependency graph
requires:
  - phase: 86-multi-key-composite-strategy
    provides: reconstruct_native_nav_and_twr native-unit reconstruction (the blow-up path)
provides:
  - Pure offline strict-xfail repro of the HARD-01 composite metric blow-up on the REAL native core
  - Branch-selector diagnostic proving b1 (magnitude guard) over b2 (valuation fix)
  - Shared _pnl_dominated_blowup_ledger() fixture builder for Plan 92-02 to flip GREEN
affects: [92-02, composite-factsheet, nav_twr, native_nav]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Repro-gate: strict-xfail asserting DESIRED post-fix behavior, RED pre-fix, flipped enforced in the fix plan"
    - "Branch selection by fixture evidence (assertion outcome IS the selector), not reasoning"

key-files:
  created: []
  modified:
    - analytics-service/tests/test_native_nav.py

key-decisions:
  - "Fix branch b1 selected by fixture evidence — the reconstruction values equity correctly (Σ B×mark), the tiny denominator is economically real, so the defect is the missing P&L-magnitude guard (not valuation)."
  - "Pre-history balance seeded to exactly 0 via a native BTC inception deposit so the §5 inception gate reconciles under full_history=True and valuation reaches the divide."

patterns-established:
  - "Pattern: hand-rolled NativeLedger through the real reconstruct_native_nav_and_twr, constant mark cancels so r_t = pnl_t/B_{t-1} is hand-auditable in comments."

requirements-completed: [HARD-01]

# Metrics
duration: ~18min
completed: 2026-07-11
---

# Phase 92 Plan 01: Composite Metric Blow-Up Repro Fixture Summary

**A pure, offline strict-xfail on the REAL `reconstruct_native_nav_and_twr` reproduces the HARD-01 ~1,700%/day composite blow-up (captured r ≈ 17.33/day), and a green branch-selector diagnostic proves the fix belongs in the denominator guard (b1), not the valuation (b2).**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-11
- **Completed:** 2026-07-11
- **Tasks:** 2/2
- **Files modified:** 1 (`analytics-service/tests/test_native_nav.py`)

## Accomplishments

### Task 1 — strict-xfail blow-up repro (RED evidence)
Added `_pnl_dominated_blowup_ledger()` + `test_inverse_perpetual_pnl_dominated_day_is_guarded`. A single INDEXED "BTC" bucket over 7 UTC days (2024-01-01..07) with a native inception deposit of 0.025 BTC seeding pre-history to exactly 0, and a day-3 P&L of 0.52 BTC. The backward roll gives a day-2 balance of 0.030 BTC → prev NAV = 0.030 × $88,000 = **$2,640** (ABOVE `DUST_NAV_FLOOR` $1,000, so no existing guard fires — research A3), while day-3 P&L values to ~$45,760 → an un-guarded per-day return.

The test asserts the DESIRED post-fix behavior (`|r| < 5` on every non-NaN day) and is decorated `@pytest.mark.xfail(strict=True)`, so it is RED now while keeping the suite green. Day 1 is a leading NaN terminus (`negative_nav_guard`, prev0 ≈ 0), not the bug.

### Task 2 — branch-selector diagnostic (b1 vs b2)
Added `test_blowup_fixture_nav_valuation_matches_hand_model`, reusing the same ledger. With the mark constant at $88,000 it cancels in the ratio, so each emitted return equals `pnl_t / B_{t-1}`. The test asserts the non-dominated days (d2, d4..d7) match the hand-computed backward-roll model at `rel=1e-9`; d3 is deliberately NOT asserted (post-fix it becomes a guarded NaN; its pre-fix magnitude is captured by Task 1). It PASSES → the NAV valuation is correct → the small denominator is economically real.

## RED Repro-Gate Evidence

`--runxfail` capture (verbatim), the phase's no-reasoning-alone gate:

```
E  AssertionError: un-guarded P&L-dominated return(s) emitted (HARD-01 blow-up):
   {Timestamp('2024-01-03 00:00:00'): 17.33333333333332}
```

Captured exploded return: **r(2024-01-03) = 17.33333333333332** (i.e. +1,733%/day), matching the hand computation 45,760 / 2,640. `> 5` confirms the blow-up class; the strict-xfail structurally forces Plan 92-02 to flip it GREEN (remove the marker) once the magnitude guard lands.

## Fix branch selected by fixture evidence: b1 — the reconstruction values the equity correctly (Σ B×mark; non-dominated days match the hand model at rel=1e-9 and d3's r = pnl_d3/B_d2 ≈ 17.33), so the tiny denominator is economically real and the defect is the missing P&L-magnitude guard in `_guard_denominator`, NOT an inverse-valuation artifact.

## Verification

- `cd analytics-service && .venv/bin/python -m pytest tests/test_native_nav.py -k pnl_dominated -q` → `1 xfailed` (strict — the bug reproduces).
- `... -k pnl_dominated -q --runxfail` → `1 failed` with the captured `AssertionError` r = 17.33 (RED evidence above).
- `... -k "valuation_matches_hand_model or pnl_dominated" -q` → `1 passed, 1 xfailed`.
- `... tests/test_native_nav.py -q` (full file) → **46 passed, 1 xfailed, 0 failed** — no existing test disturbed.
- Diff source-scan: no `supabase`/`httpx`/`requests`/`socket`/`urllib`/`create_client` imports → pure offline (research Pitfall 6, T-92-01 synthetic quantities only).

## Deviations from Plan

None — plan executed exactly as written. The hand-computed pre-blow-up NAV ($2,640, above the dust floor) and the captured r (≈17.33) match the plan's predicted values.

## Handoff to Plan 92-02

- Fix branch: **b1** (add a P&L/return-magnitude guard to `nav_twr._guard_denominator`, register a new `pnl_dominated_guard`/`return_magnitude_guard` key in `NAV_TWR_GUARD_KEYS` + `_build_nav_meta` + `DataQualityFlags`).
- On landing the guard: day 3 becomes a guarded NaN (interior break), the strict-xfail marker must be REMOVED (else it XPASS-errors), and days 4–7 form the rising ≥4-day retained suffix for the CAGR>0 assertion.
- Blast-radius discipline: default the cap high enough that flow-less / non-exploding single-key and shipped-composite series stay byte-identical (SC-4 pins).

## Self-Check: PASSED

- `analytics-service/tests/test_native_nav.py` — FOUND (modified, 2 new tests + fixture builder).
- Commit `9b65aea2` (test 92-01 strict-xfail repro) — FOUND.
- Commit `8d3c3d50` (test 92-01 branch-selector diagnostic) — FOUND.
