---
phase: 226-mt5soak-the-mt5-soak-checks-what-it-claims-independently-of
verified: 2026-11-24T00:00:00Z
status: passed
score: 4/4 must-haves verified
verified_at_sha: a7c5121f62e79273ad2b6008cc49c62c235a0c4a
drift_subjects:
  - analytics-service/scripts/mt5_soak.py
  - analytics-service/tests/test_mt5_soak.py
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

# Phase 226: MT5SOAK Verification Report

**Phase Goal:** The MT5 derive soak (`analytics-service/scripts/mt5_soak.py`) becomes an oracle that cannot agree with the derive by construction (PITFALLS Pitfall 12). It judges a BTC-unit account on floors in its own unit, rejects NaN and implausible timed-day returns (not only infinity), checks each deal's day against its own per-day walk that imports no production helper, and lands as wave 0. One file; no migration; no published number moves.
**Verified:** 2026-11-24
**Status:** passed
**Re-verification:** No, initial verification. The final code at HEAD was verified, including the post-plan fix commits `0c6f55e67`..`969faa901`, not only the SUMMARY claims.

## Goal Achievement

### Observable Truths (ROADMAP success criteria, plus PLAN must-haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1 / SOAK-01: a BTC-unit account is judged on BTC floors, not `USD_FLOORS`; a test feeds a BTC account USD floors pass and BTC floors fail | VERIFIED | `reconcile_parity` resolves the unit once and passes `floors=unit.floors` to the combiner (line ~1163), to `_reconcile_published_returns` (~1224), `_parity_tolerance(balance, unit.floors)` (~1241) and the wedge dust gate (~1261). An unresolvable currency is INCONCLUSIVE (`unit_unresolved`), never a USD fallback. `test_a_btc_series_usd_floors_would_pass_reds_on_btc_floors`: BTC floors give ok False with `checked_day_not_finite`; USD floors give (ok True, checked 2, guarded 1, 0 mismatches). My own neuter (both `unit.floors` call sites set to `USD_FLOORS`) made it fail: `E assert True is False`. |
| 2 | SC2 / SOAK-02: the timed-day check rejects NaN and implausible returns as well as infinity, and goes RED on a 1e-3 nudge | VERIFIED | The timed branch of `_reconcile_published_returns` compares each timed day exactly against the soak's own D-17 cohort walk (`_walk_cohorts`, `_walk_timed_return`, `_walk_day_guard`). The kinds are `timed_return_off_cohort_walk`, `timed_day_not_nan` and `timed_day_not_finite`. `test_a_small_nudge_on_a_timed_day_reddens_the_gate` nudges 2025-10-17 by `1e-3`. My own neuter (`if err > _RETURN_CHECK_TOL:` became `if False:` in the timed branch) went RED: `assert ('2025-10-17', 'timed_return_off_cohort_walk') in set()`. NaN, inf, 7.0 and -0.99 have their own tests in the file. |
| 3 | SC3 / SOAK-03: day attribution is checked against an independent per-day walk that imports no production helper, and goes RED when one deal is moved by one UTC day | VERIFIED | `_walk_deal_ledger` and `_walk_attribution_check` compare the walk against the fold's per-day P&L, flows and timed set. I ran an AST check of every `_walk_*` function: none references an imported production name. `_reconcile_published_returns` references only `USD_FLOORS` (a default value) and `UnitFloors` (a type), both account_unit data, no `nav_twr`, `broker_dailies` or `mt5_deals` helper (this is recorded LOW IN-03). `test_the_walk_imports_no_production_helper` passes. Neuter of the attribution tolerance compare: `test_a_deal_moved_one_utc_day_in_the_fold_reddens_attribution` went RED with `day_attribution_mismatch` and `timed_day_unconfirmed`. |
| 4 | SC4 / PROOF-01: each check goes RED on a neutered copy with its own arm first, restored from a byte backup (`cp`, `cmp`), then GREEN; recorded verbatim in the plan SUMMARY | VERIFIED | The phase-level index check from 226-05-PLAN Task 3 (14 arm ids, each with `RED: E`, `cmp: exit 0` and `GREEN: N passed` rows across 226-01..05-SUMMARY) printed nothing and exited 0 (INDEX-OK). The SUMMARY rows predate the post-plan fix commits, so I re-ran the three headline neuters on the final code (above). Each went RED with its named arm, was restored with `cp` from a byte backup, `cmp` exit 0, `git diff --quiet` CLEAN, and the file ran GREEN (158 passed). |
| 5 | PLAN 05 truth: `certified_share >= _MIN_CHECKED_SHARE` (0.5) is required; one checked day among about 200 is not green; tiny-base NaN explained by the soak's own reading | VERIFIED | `_MIN_CHECKED_SHARE = 0.5`, `_walk_tiny_base_days` (standard library only, constants `_WALK_TINY_BASE_FRACTION` and `_WALK_TINY_BASE_WINDOW_DAYS`), and their drift pins to `services.tiny_base` are present and exercised by passing tests. Rows SOAK02-share and SOAK02-tiny are complete in 226-05-SUMMARY. |
| 6 | Review fixes: all 4 HIGH and 10 MEDIUM findings fixed (CR-01..CR-04, WR-01..WR-05, SFH-01..04) | VERIFIED | `226-REVIEW-DISPOSITION.md` maps each finding to a fix commit. All of those commits are in `git log origin/main..HEAD`. The 158 tests in `tests/test_mt5_soak.py` include the pins those fixes added. 11 LOW findings (IN-01..IN-11) are recorded only, per repo rule (a). |

**Score:** 4/4 ROADMAP success criteria verified (6/6 including plan and review truths); 0 behavior-unverified. Every behavior-dependent truth has a named passing test, and I confirmed each of the three headline ones goes RED on my own neuter.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/scripts/mt5_soak.py` | unit-resolved floors, soak-owned walk, cohort compare, share floor, tiny-base reading | VERIFIED | 1433 lines, substantive, wired through `reconcile_parity` into `run_soak` and `main`. |
| `analytics-service/tests/test_mt5_soak.py` | tests for every arm, independence AST test, drift pins | VERIFIED | 2927 lines, 158 passed in about 18 s. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `reconcile_parity` | combiner, guard, level tolerance, wedge gate | `unit.floors` | WIRED | Confirmed at the four call sites. |
| `reconcile_parity` | `_walk_attribution_check` and `_reconcile_published_returns` | walk output | WIRED | The walk is built from raw deals and compared with the fold. |
| `_walk_tiny_base_days` | `services/tiny_base.py` | spec only, drift-pinned constants | WIRED (by design) | No import; constants pinned by a test. |
| `main` exit code | `parity_ok` / `return_check.ok` incl. `certified_share` | exit 0 only when green | WIRED | Share floor is part of `ok`. |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| the walk | per-day P&L, flows, timing | the raw MT5 deal list read from the broker client | yes (own parse, `_walk_money`, `_walk_epoch`) | FLOWING |

### Behavioral Spot-Checks and PROOF-01 re-runs (mine, on the final code)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Whole soak test file | `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q` | 158 passed (the plan text said 100; the count grew with the review fixes) | PASS |
| BTC-floor arm neuter | both `floors=unit.floors` become `floors=USD_FLOORS`; run `test_a_btc_series_usd_floors_would_pass_reds_on_btc_floors` | RED `E assert True is False`; `cmp` exit 0 | PASS |
| timed-day arm neuter | `if err > _RETURN_CHECK_TOL:` (timed branch) becomes `if False:`; run `test_a_small_nudge_on_a_timed_day_reddens_the_gate` | RED `assert ('2025-10-17', 'timed_return_off_cohort_walk') in set()`; `cmp` exit 0; GREEN `1 passed` after restore | PASS |
| attribution arm neuter | tolerance compare replaced by `> 1e30`; run `test_a_deal_moved_one_utc_day_in_the_fold_reddens_attribution` | RED with `day_attribution_mismatch` and `timed_day_unconfirmed`; `cmp` exit 0 | PASS |
| After all neuters | `git diff --quiet -- analytics-service/scripts/mt5_soak.py` | clean; file back to the committed bytes | PASS |
| Phase boundary | `git diff --stat origin/main...HEAD -- analytics-service/services supabase/migrations` | empty | PASS |
| Non-planning files changed | `git diff --name-only origin/main...HEAD` minus `.planning` | only `mt5_soak.py` and `test_mt5_soak.py` | PASS |

The first attempt at the timed neuter used a BSD `sed -i` call that failed to apply. That test run was therefore unneutered and passed, and I discarded it. I redid the neuter with a Python edit, which is the RED result recorded above.

### Probe Execution

Step 7c: SKIPPED. No `probe-*.sh` is declared by the phase.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SOAK-01 | 226-01 | BTC account judged on its own unit's floors | SATISFIED | Truth 1. |
| SOAK-02 | 226-03, 226-04, 226-05 | timed-day check rejects NaN and implausible returns; RED on a 1e-3 nudge; minimum checked share | SATISFIED | Truths 2 and 5. |
| SOAK-03 | 226-02 | attribution against an independent walk; RED on a one-day move | SATISFIED | Truth 3. |
| PROOF-01 | all plans (milestone-wide) | each gate proven able to fail, recorded verbatim | SATISFIED for this phase | Truth 4. REQUIREMENTS.md leaves PROOF-01 Pending by design until the milestone audit. |

All IDs declared in the five PLAN frontmatters (SOAK-01, SOAK-02, SOAK-03) appear in REQUIREMENTS.md, marked `[x]` and "Complete" in the traceability table. There are no orphaned SOAK requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `mt5_soak.py` | n/a | `TBD`, `FIXME`, `XXX`, `TODO` | none | zero markers in either file |
| `mt5_soak.py` | 1055, 1122, 1301, 1305 | `mypy --strict` on this script reports 4 errors (bare `dict` type args, one untyped call) | Info | `scripts/` is outside CI's mypy scope (`services/ routers/ models/`), so no gate fails. Not a goal gap. |

### Notes carried forward (not gaps)

- LOW findings IN-01..IN-11 are recorded in `226-REVIEW-DISPOSITION.md`, with no TODOS entries. Of these, IN-03 (USD default floors on two helpers) and IN-09 (the independence checker misses `__import__` and `importlib`) are the ones a later reader should know about.
- `_MIN_CHECKED_SHARE = 0.5` rests on fixture shares, not a live soak record (no record exists to calibrate against).
- `tests/test_account_unit.py::test_dust_nav_floor_name_is_an_alias_of_the_usd_row` still names `scripts/mt5_soak.py` as an importer of the USD dust alias. It passes today and sits outside the phase boundary.
- I did not run the full workspace suite, as instructed. Its latest result is in the fix reports.
- The orchestrator's "no fourth review round" decision for round-3 fixes is recorded in the disposition. I checked the final code directly, and it holds.
- The stale-`covered_*` convention does not apply: this report carries `verified_at_sha` and `drift_subjects` only.

### Human Verification Required

None. The phase is a test-covered oracle with no UI or external-service behavior. Every behavior-dependent truth has a passing named test that I saw go RED on a neuter.

### Gaps Summary

No gaps. The soak judges BTC accounts on BTC floors, recomputes each timed day with its own cohort walk and compares it exactly, attributes every deal's day through a walk that imports no production helper, and requires a minimum certified share. Each arm is proven able to fail with a restore-and-cmp record, and the phase touches only the two soak files. It adds no migration and moves no published number.

---

_Verified: 2026-11-24_
_Verifier: Claude (gsd-verifier)_
