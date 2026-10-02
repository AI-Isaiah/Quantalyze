---
phase: 92-composite-metric-blow-up-annualization-honesty
verified: 2026-07-11T17:10:53Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  note: "Initial goal-backward verification (no prior VERIFICATION.md; 92-VALIDATION.md is the pre-execution validation contract, not a verification record)."
human_verification:
  - test: "Live prod re-stitch of the Titan Forge / Zavara inverse-Deribit composite (or an equivalent live composite) and eyeball the factsheet."
    expected: "No per-key contribution in thousands/millions of %; CAGR/Cumulative non-zero while the curve rises; if the retained window is <90 calendar days, the amber insufficient_window DQ caveat is visible on the hero strip and wizard preview."
    why_human: "Corroboration only — NOT a closure gate. The roadmap accepts the offline Deribit-inverse fixture as the closure evidence, and VALIDATION.md explicitly labels this live check 'corroboration'. The self-heal path (full-delete + overwrite on re-stitch) means live bad data heals on the owner's next re-stitch. Listed for completeness; the phase goal is fully evidenced by the mutation-proven fixture + component render tests below."
---

# Phase 92: Composite Metric Blow-Up & Annualization Honesty — Verification Report

**Phase Goal:** A composite factsheet never renders absurd metrics — the stitched series and every dependent KPI are finite and correct, and a too-short window is honestly flagged instead of silently over-annualized.
**Verified:** 2026-07-11T17:10:53Z
**Status:** passed
**Re-verification:** No — initial verification
**Verified against HEAD:** `8a6110fa` (all 7 phase commits present on branch)

## Method

Goal-backward, adversarial. SUMMARY claims were treated as unverified. Every truth was re-proven by running the pinned 3.12 venv (`analytics-service/.venv/bin/python -m pytest`), reading the actual source at the fix sites, and executing a **live source mutation** to confirm the reproduced-then-fixed gate (the roadmap's no-reasoning-alone hard gate). pandas 3.0.3 / numpy 2.5.1 confirmed.

## Goal Achievement

### Observable Truths

| # | Truth (roadmap Success Criterion) | Status | Evidence |
|---|-----------------------------------|--------|----------|
| SC-1 | Composite factsheet renders finite, plausible metrics — no per-key contribution in thousands/millions of %, no CAGR/Cumulative 0.0% while the curve rises | ✓ VERIFIED | `test_finite_composite_headline_after_pnl_guard` PASSED — on the guarded fixture `cumulative_return` collapses to 0.031 (from pre-fix ~20.0) and `cagr` is finite/positive (from pre-fix ~3.3e96). `test_blowup_member_persists_finite_series_and_plausible_contribution` PASSED — every persisted `csv_daily_returns` finite, exploded day ABSENT, per-key contribution basis Π(1+r)−1 ≈0.15 (vs live +1,489,363.8%). |
| SC-2 | Near-zero-equity blow-up root-caused + a regression reproduces it (FAILS without fix, PASSES with it); fix at the source, not display | ✓ VERIFIED | `test_native_nav.py` → 47 passed, **0 xfailed** (was 46+1 strict-xfail pre-fix). **Live mutation:** raising `PNL_DOM_RATIO 10.0→1e18` reddens `test_inverse_perpetual_pnl_dominated_day_is_guarded` with the exact capture `r(2024-01-03)=17.33333333333332`; restoring makes it pass. Fix is at the source: `nav_twr.py:427-430` (`pnl_t = cur-prev-flow_t; if abs(pnl_t) >= PNL_DOM_RATIO*prev: flags["pnl_dominated_guard"]=True; continue`), NOT the display layer. |
| SC-3 | Short window carries `insufficient_window` DQ flag at the CAGR site, value UNCHANGED, not a new metrics_json key, user-visible | ✓ VERIFIED | `metrics.py -k insufficient_window` → 5 passed incl. `test_insufficient_window_geometric_short_flagged_value_unchanged` asserting `result["cagr"] == expected_cagr` (hand formula, rel=1e-12) AND `test_insufficient_window_never_leaks_into_metrics_json`. Flag rides `MetricsResult.insufficient_window` field (`metrics.py:294`, set at `:1236`), lifted at both callers (`job_worker.py:3571`, `analytics_runner.py:1839/2369`). Render surfaces: vitest 40 passed across the 3 pin files. |
| SC-4 | Closure evidenced against the fixture, not reasoning | ✓ VERIFIED | The reproduced-then-fixed gate was executed live (SC-2 mutation above), not asserted from narrative. The fixture is the roadmap-accepted "Deribit-inverse reproduction fixture" alternative to the live repro. |

**Score:** 4/4 truths verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/nav_twr.py` | `PNL_DOM_RATIO` + `pnl_dominated_guard` at source, registered in `NAV_TWR_GUARD_KEYS`, `NavTWRMeta`, `_build_nav_meta` | ✓ VERIFIED | `PNL_DOM_RATIO=10.0` (:79); guard at call site (:428-430); key in tuple (:192); meta assign (:551-552). |
| `analytics-service/services/analytics_runner.py` | `pnl_dominated_guard` + `insufficient_window` in `DataQualityFlags` + single-key lift | ✓ VERIFIED | TypedDict keys (:192, :229); present-only additive lift at both compute sites (:1839, :2369). mypy clean per SUMMARY; suite green. |
| `analytics-service/services/metrics.py` | `MIN_ANNUALIZATION_DAYS` + `insufficient_window` at both CAGR sites via MetricsResult field | ✓ VERIFIED | `MIN_ANNUALIZATION_DAYS=90` (:67); field (:294); geometric (:698) + simple (:627) branches; CAGR expr (:683-685) untouched. |
| `analytics-service/services/job_worker.py` | `merged_flags` lift with drop-stale | ✓ VERIFIED | set at :3572, `pop` drop-stale at :3574. |
| `src/lib/factsheet/*` + `FactsheetView.tsx` + `SyncPreviewStep.tsx` | render `insufficient_window` on existing surfaces, no new component | ✓ VERIFIED | vitest render pins (3 files, 40 tests) PASSED; strict `=== true` coercion. |
| `analytics-service/tests/test_native_nav.py` | fixture builder + enforced regression + branch selector | ✓ VERIFIED | 47 passed, 0 xfailed; mutation-honest (proven live). |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `test_native_nav.py` | `reconstruct_native_nav_and_twr` (real prod fn) | direct import, no reimplementation | ✓ WIRED — tests drive the real function; pure/offline (no supabase/httpx imports per 92-01 scan). |
| `nav_twr.py` guard | `NAV_TWR_GUARD_KEYS` → lift/promotion registries | one-owner tuple iteration | ✓ WIRED — worker member-lift promotes `computation_status=complete_with_warnings` (asserted in Layer-3 test). |
| `metrics.py` → `MetricsResult.insufficient_window` | `data_quality_flags` at both callers | field read (NOT metrics_json key) | ✓ WIRED — composite `merged_flags` + single-key `DataQualityFlags`; `not in metrics_json` pinned. |
| `data_quality_flags.insufficient_window` | wizard + factsheet DQ caveat | `=== true` parse → render | ✓ WIRED — 40 vitest assertions incl. renders-when-true / absent-when-false. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Repro is enforced green (0 xfail) | `pytest tests/test_native_nav.py -q` | 47 passed | ✓ PASS |
| Reproduced-then-fixed gate (mutation) | neuter `PNL_DOM_RATIO`→1e18, run repro | FAILED w/ r=17.33; restored→PASS | ✓ PASS |
| Finite headline + finite persisted series | `pytest -k finite_composite`, `-k blowup` | 1+1 passed | ✓ PASS |
| CAGR value byte-identical under flag | `pytest -k insufficient_window` | 5 passed | ✓ PASS |
| Both-caller lifts + drop-stale | `pytest test_stitch_composite_job test_analytics_runner -k insufficient_window` | 4 passed | ✓ PASS |
| Render surfaces | `vitest run` 3 pin files | 40 passed | ✓ PASS |
| SC-4 blast-radius (byte-identity + golden + parity + #597) | `pytest test_nav_twr test_native_nav_sc4_identity test_golden_parity test_metrics_parity test_metrics_minigolden test_mt5_golden_fixtures` | 154 passed | ✓ PASS |
| No regression (full analytics suite) | `pytest -q` | 3584 passed, 92 skipped, 0 failed | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| HARD-01 | 92-01, 92-02 | Composite factsheet never renders absurd metrics; root-cause + fix the inverse-Deribit near-zero-equity denominator blow-up | ✓ SATISFIED | SC-1 + SC-2 verified; source guard + mutation-proven regression. |
| HARD-04 | 92-03 | Short/flow-heavy window carries `insufficient_window` at the CAGR site, value unchanged (#67) | ✓ SATISFIED | SC-3 verified; value-invariant pin + both-caller lift + render surfaces. |

### Documented Deviations — assessed legitimate (not masking a defect)

1. **92-02: `abs(cagr) < 10` → intent-assertion.** The plan's literal bound is unachievable on the shared immutable fixture because the guard leaves a legitimately-short 3-day retained suffix that annualizes to ~+3,960% — this is precisely the HARD-04 short-window class fixed in 92-03, NOT the HARD-01 blow-up. The replacement still reddens on the actual blow-up (pre-fix cumulative ~20, cagr ~3.3e96) and is mutation-honest. LEGITIMATE.
2. **92-03: 15→120-day clean-run invariant.** A 15-business-day fixture (~20 calendar days) now legitimately carries `insufficient_window` (< 90), so the zero-flags assertion moved to a genuinely-clean 120-day window — preserving the test's intent (no spurious flag + no status promotion on a clean run). Direct consequence of the new flag, not a weakening. LEGITIMATE.

### Anti-Patterns Found

None blocking. No unreferenced `TBD`/`FIXME`/`XXX` in the modified analytics source (comments reference HARD-01/HARD-04/#67 formal work). No stub/placeholder returns; the guard breaks-and-flags (NaN, never substitutes) per the no-invented-data invariant. Leak discipline held: `pnl_dominated_guard` / `insufficient_window` are booleans only (0 raw-magnitude leaks, per 92-02 diff-grep).

### Human Verification (optional corroboration — NOT a gate)

See frontmatter `human_verification`. A live prod re-stitch would visually corroborate the finite factsheet + amber DQ caveat, but the roadmap explicitly accepts the offline Deribit-inverse fixture as closure evidence and VALIDATION.md labels the live check "corroboration". The reproduced-then-fixed gate was satisfied live via the fixture mutation. Status is **passed**; this item is informational.

### Gaps Summary

None. All 4 roadmap success criteria are verified with live test evidence. The blow-up is root-caused at the denominator source (`nav_twr.py` `pnl_dominated_guard`), the regression fails without the fix and passes with it (proven by live mutation, not narrative), the persisted series / per-key contribution / headline scalars are all finite and mutually consistent, the `insufficient_window` flag is stamped at the CAGR site with a byte-identical value on a `MetricsResult` field (never a metrics_json key), lifted at both callers, and rendered on both existing DQ surfaces. Shared-path byte-identity (SC-4 + golden + parity + #597) and the full 3584-test analytics suite are green — no regression.

---

_Verified: 2026-07-11T17:10:53Z_
_Verifier: Claude (gsd-verifier)_
