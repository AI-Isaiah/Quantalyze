---
phase: 111-constit-unified-constituent-presentation-parity-pre-check-re
plan: 01
subsystem: testing
tags: [numpy, pandas, pytest, scenario-blend, parity-gate, tsx, vitest]

# Dependency graph
requires:
  - phase: 108-backbone-unification
    provides: "frozen computeScenario engine (src/lib/scenario.ts) — the byte-frozen blend the oracle re-derives"
provides:
  - "CONSTIT-05 gate GREEN: independent pandas re-derivation proves the composer blend == frozen engine (interpretation A, fixed-weight-per-key)"
  - "Committed deterministic fixture + engine golden (constit_parity_fixture.json / constit_parity_golden.json)"
  - "Re-runnable pytest gate (test_constit_blend_parity.py) that fails if the blend definition ever drifts"
  - "Founder-facing A-vs-B divergence datum (time-varying book return differs by +0.012165 terminal wealth) for any future re-baseline conversation"
affects: [111-02, 111-03, 111-04, CONSTIT-UI, 114-E1, 115-E2]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Committed-oracle parity gate: TS capture script (the ONLY scenario.ts importer) → sorted-key JSON golden → offline pandas re-derivation asserts A, reports B"
    - "Anti-tautology fixture design: ragged starts + front/back weight drift + cashflow variant so A and B measurably diverge (a symmetric fixture answers nothing)"

key-files:
  created:
    - scripts/capture-constit-parity-golden.ts
    - analytics-service/tests/fixtures/constit_parity_fixture.json
    - analytics-service/tests/fixtures/constit_parity_golden.json
    - analytics-service/tests/test_constit_blend_parity.py
  modified: []

key-decisions:
  - "GATE VERDICT: PARITY VERIFIED. The composer renders interpretation A (fixed-weight-per-key); Wave 2+ UI may proceed."
  - "The engine weight is each key's final-day equity (current-equity snapshot); normalization cancels so raw weights suffice in the oracle."
  - "Equities stored as unitless capital units (no USD magnitudes committed or printed) per T-111-01."
  - "Ragged-start pre-start drop exercised via each StrategyForBuilder's start_date (engine union-path include-from), not via startDates state."

patterns-established:
  - "Determinism proven by hash-equal re-run (no RNG, no Date.now, no live DB) — the gate genuinely runs in CI (no skipif)."
  - "KPI parity tolerance = golden rounding granularity + margin (1e-5 for 5dp, 1e-3 for 3dp); curve at 1e-9."

requirements-completed: [CONSTIT-05]

# Metrics
duration: 22min
completed: 2026-07-16
---

# Phase 111 Plan 01: CONSTIT-05 Parity Gate Summary

**PARITY VERIFIED — an independent numpy/pandas re-derivation reproduces the frozen-engine composer blend as interpretation A (fixed-weight-per-key) within 1e-9 on the curve and rounding granularity on all KPIs; the time-varying-per-position hypothesis (B) is reported, not asserted, and diverges by +0.012165 terminal wealth.**

## Gate Outcome

**✅ PARITY VERIFIED (interpretation A == frozen engine).** No re-baseline needed. Wave-2 CONSTIT UI (plans 111-02/03/04) is UNBLOCKED per ROADMAP 111 SC-1.

### A-vs-B divergence (founder-facing datum)

| Metric | A (fixed-weight-per-key, = composer/engine) | B (time-varying-per-position) | A − B |
|--------|---------------------------------------------|-------------------------------|-------|
| Terminal wealth mult | 1.24325884 | 1.23109361 | **+0.01216524** |
| TWR | +0.243259 (24.33%) | +0.231094 (23.11%) | +0.012165 |
| Sharpe | 11.3399 | 10.8133 | +0.527 |
| max drawdown | −0.032254 | −0.032413 | +0.000159 |
| max abs daily-return divergence | — | — | 4.29e-04 |

**Interpretation:** The composer's rendered blend is the **fixed-weight** interpretation. A hypothetical "true book return" that weights each key by its *drifting daily equity share* (B) would display a materially different number — about **1.2 percentage points lower TWR** and a lower Sharpe on this fixture. This is the datum a future re-baseline conversation would weigh (RESEARCH A3 / CONTEXT CONSTIT-05). No decision is forced now: the current canonical definition (A) reproduces the engine exactly, so the gate is green and the displayed numbers are unchanged.

**Cashflow variant (divergence-watch #7):** `B(deposit-stepped equity) − B(clean) = +0.00499517`. Interpretation A is **cashflow-neutral by construction** (it blends TWR series; a synthetic deposit to key_b at day 70 does not move A). A $-equity-weighted book (B) *does* react to the deposit — confirming the composer correctly compares TWR-to-TWR, never TWR-to-$-equity (Pitfall 2 pre-empted).

These facts also live durably in the `test_constit_blend_parity.py` module docstring (the `.planning/` dir is local-only).

## Performance

- **Duration:** ~22 min
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 0 (engine byte-frozen)

## Accomplishments
- Deterministic 3-key fixture (120 days, ragged start@20, front/back weight drift, cashflow variant) + one-shot frozen-engine golden, byte-identical on re-run.
- Independent pandas oracle re-deriving the blend two ways; A asserted == golden (curve 1e-9, KPIs at rounding granularity), B reported.
- Gate confirmed offline/deterministic (no skipif) so it genuinely gates CI and fails if the blend definition drifts.
- Engine freeze proven intact: `git diff --exit-code src/lib/scenario.ts` clean, SC-3 keep-gate green (5/5), scenario.test.ts behavior pins green (50/50).

## Task Commits

1. **Task 1: Deterministic fixture + frozen-engine golden capture** — `7ac877d2` (feat)
2. **Task 2: Pandas parity oracle — assert A, report B** — `e2dc95f7` (test)
3. **Task 3: Evaluate gate + record outcome** — this SUMMARY + docstring (no code change; verification-only)

## Files Created/Modified
- `scripts/capture-constit-parity-golden.ts` — Deterministic fixture generator + the ONLY scenario.ts importer (read-only golden capture).
- `analytics-service/tests/fixtures/constit_parity_fixture.json` — Committed inputs: 3 keys, ragged starts, weight drift, unitless equity paths, cashflow variant.
- `analytics-service/tests/fixtures/constit_parity_golden.json` — computeScenario output: full-res unrounded portfolio daily returns + downsampled curve + KPIs.
- `analytics-service/tests/test_constit_blend_parity.py` — The CONSTIT-05 gate (5 tests): A asserted vs golden, gap-fill semantics, A-vs-B report.

## Decisions Made
- **Verdict PARITY VERIFIED** — A reproduces the engine's own arithmetic (as RESEARCH predicted since A = the composer's live semantics); the gate is a drift-guard going forward.
- Fixture equities kept unitless (capital units), sidestepping the USD-magnitude leak class entirely (T-111-01) rather than merely suppressing prints.
- Time-varying B uses beginning-of-day (prior-close) equity share as the natural book-return weighting; documented in the oracle.

## Deviations from Plan

None — plan executed exactly as written. The gate resolved to the expected (matching) branch; no tolerance loosening, no oracle/golden edits, no HARD STOP triggered.

## Issues Encountered
None. tsx resolved the `@/` path alias natively (matching existing `scripts/*.ts` convention); the `.venv` carries the pinned numpy 2.5.1 / pandas 3.0.3 / pytest 9.1.1.

## Threat Flags
None — no new network endpoint, auth path, file access, or schema surface. Synthetic fixture only; oracle prints returns/ratios, never USD magnitudes (T-111-01 mitigated). Engine untouched (T-111-02 mitigated: `git diff --exit-code src/lib/scenario.ts` clean + SC-3 green).

## Next Phase Readiness
- **CONSTIT-05 gate GREEN → Wave-2 UI unblocked.** Plans 111-02/03/04 may proceed under the confirmed canonical blend definition (interpretation A, fixed-weight-per-key).
- The A-vs-B divergence (+0.012165 terminal wealth) is on record should the founder ever choose to re-baseline to a time-varying book return (would change displayed numbers; not in scope for v1.11 CONSTIT).

## Self-Check: PASSED

All 4 created artifacts exist on disk; both task commits (`7ac877d2`, `e2dc95f7`) present in git history. Engine byte-frozen (`scenario.ts` diff clean), SC-3 keep-gate 5/5 green, scenario.test.ts 50/50 green, parity gate 5/5 green.

---
*Phase: 111-constit-unified-constituent-presentation-parity-pre-check-re*
*Completed: 2026-07-16*
