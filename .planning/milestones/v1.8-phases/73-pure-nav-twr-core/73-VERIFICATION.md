---
phase: 73-pure-nav-twr-core
verified: 2026-07-05T22:30:00Z
status: passed
score: 17/17
overrides_applied: 0
re_verification: false
---

# Phase 73: Pure NAV/TWR Core — Verification Report

**Phase Goal:** A pure, I/O-free `services/nav_twr.py` computes honest chain-linked TWR from a
backward-reconstructed daily NAV series, with every denominator fail-loud guarded — no network,
no silent base substitution possible.
**Verified:** 2026-07-05T22:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (TWR-01) nav_twr.py backward NAV roll `NAV_{t-1}=NAV_t-pnl_t-F_t` matches numpy-pinned oracle to fp precision | VERIFIED | `test_backward_nav_matches_numpy_oracle` 13/13 PASS; `test_nav_roll_mutation_detected` confirms oracle sensitivity |
| 2 | (TWR-01) nav_twr.py is PURE — no network/IO imports (requests/ccxt/httpx/urllib/DB) | VERIFIED | `grep -nE '(^import\|^from)' nav_twr.py` shows only `collections`, `typing`, `numpy`, `pandas`, `deribit_txn`, `transforms` (in-repo, read-only) |
| 3 | (TWR-02) Chain-linked `r_t=(NAV_t-NAV_{t-1}-F_t)/NAV_{t-1}` with flow in NUMERATOR; cumulative computed | VERIFIED | `chain_linked_twr` at nav_twr.py L174; formula matches verbatim; `test_twr_edge_cases` PASS |
| 4 | (TWR-02) day-0 flow, same-day multi-flow, zero-NAV interior break, partial window each produce correct output | VERIFIED | `test_twr_edge_cases` covers all four cases — PASS |
| 5 | (TWR-02) Nav_twr per-day cumulative agrees with shipped `portfolio_metrics.compute_twr` scalar | VERIFIED | `test_twr_agrees_with_compute_twr` PASS (rtol 1e-12) |
| 6 | (DQ-01) Three fail-loud guards: dust (`prev_nav < $1000`), negative (`prev_nav <= 0`), flow-dominated (`\|F\| >= NAV_{t-1}`) each break the chain-link and raise `complete_with_warnings` — never fabricate | VERIFIED | `_guard_denominator` at nav_twr.py L222; `test_dq_guards_flag_not_substitute` PASS; `estimated_start <= 0` account flags NaN instead of substituting |
| 7 | (DQ-01) Source scan: nav_twr.py contains NO `.replace(0`, `.clip(`, `np.clip(`, `max(...floor`, `np.maximum(`, `.fillna(n)` on NAV denominator | VERIFIED | `test_no_forbidden_denominator_guards` PASS; manual grep returns no rows |
| 8 | (SC-4) With `external_flows=[]` and `open_unrealized_usd=0.0`, returns Series byte-identical to transforms.py daily_pnl branch for `estimated_start>0` account (rtol 1e-12) | VERIFIED | `test_zero_flow_byte_identical` PASS |
| 9 | (TWR-05) CAGR in `compute_all_metrics` annualizes on calendar clock: `years = elapsed-calendar-days / 365`; frequency-proof for dense crypto AND sparse CSV/MT5 | VERIFIED | `_CALENDAR_DAYS_PER_YEAR = 365.0` at metrics.py L41; `_elapsed_days = max((idx[-1]-idx[0]).days, 1)` at L484; `cagr = (1+total_return)**(_CALENDAR_DAYS_PER_YEAR/_elapsed_days)-1` at L486 |
| 10 | (TWR-05) Calmar = calendar-CAGR / \|max_drawdown\|, computed DIRECTLY — `qs.stats.calmar` no longer called | VERIFIED | `grep -c "qs.stats.calmar" metrics.py` = 0; direct `cagr / abs(max_dd)` at L503 |
| 11 | (TWR-05) Sharpe, volatility, Sortino, rolling_*, and TE/IR still annualize on `periods_per_year` (252) — unchanged | VERIFIED | `grep -cE "qs\.stats\.(sharpe\|sortino\|volatility).*periods=periods_per_year" metrics.py` = 3 |
| 12 | (TWR-05) Mutation-verified: 365-day fixture CAGR differs from old 252 computation by expected factor AND Sharpe unchanged | VERIFIED | `test_twr05_annualization_split` PASS; file-level mutation confirmed (SUMMARY documents reverting CAGR exponent turns tests RED) |
| 13 | (TWR-05) Calmar proven to derive from calendar CAGR, not qs.stats.calmar | VERIFIED | `test_calmar_uses_calendar_cagr` PASS; asserts Calmar diverges from `qs.stats.calmar(returns, periods=252)` |
| 14 | (ACC-01 infra) `classify_delta` classifies each delta into exactly one bucket: unchanged / reannualization / flow_moved / unexplained | VERIFIED | `parity_diff.classify_delta` at L158; `test_parity_diff.py` 11/11 PASS |
| 15 | (ACC-01 infra) Identical series → "unchanged"; series with 365/252 CAGR/Calmar shift → "reannualization" | VERIFIED | `test_unchanged_identical_series` and `test_reannualization_cagr_only` PASS |
| 16 | (ACC-01 infra) parity_diff.py is PURE — stdlib/typing/pandas/numpy only | VERIFIED | Import scan returns no rows outside allowed packages |
| 17 | Full test suites GREEN: nav_twr (13), metrics+parity (162), parity_diff (11) = 186 tests total | VERIFIED | Executed directly against CI-3.12 venv — all PASS |

**Score:** 17/17 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/nav_twr.py` | Pure I/O-free backward NAV reconstruction + chain-linked TWR + fail-loud DQ guards; min 120 lines; contains `def reconstruct_nav_and_twr` | VERIFIED | 308 lines; `reconstruct_nav_and_twr` at L282; 3-level check PASS |
| `analytics-service/tests/test_nav_twr.py` | numpy-oracle parity, mutation/revert-proof, edge-case, DQ-guard, source-scan, F=0 byte-identity tests; min 150 lines; contains `def test_zero_flow_byte_identical` | VERIFIED | 397 lines; `test_zero_flow_byte_identical` at L343; 13 tests passing |
| `analytics-service/services/metrics.py` | Split annualization: CAGR/Calmar on 365/calendar-days, risk metrics on 252; contains `_CALENDAR_DAYS_PER_YEAR` | VERIFIED | `_CALENDAR_DAYS_PER_YEAR` at L41; date-span CAGR block at L479-488; direct Calmar at L499-505 |
| `analytics-service/tests/test_metrics_parity.py` | TWR-05 rescale proof (CAGR shifts by calendar factor, Sharpe unchanged); contains `def test_twr05_annualization_split` | VERIFIED | Test present and PASSING |
| `analytics-service/tests/test_metrics.py` | Calmar == calendar-CAGR / \|max_dd\| assertion; contains `def test_calmar_uses_calendar_cagr` | VERIFIED | Test present and PASSING |
| `analytics-service/services/parity_diff.py` | Series-diff + delta-bucket classifier; min 40 lines; contains `def classify_delta` | VERIFIED | 203 lines; `classify_delta` at L158; UNCHANGED/REANNUALIZATION/FLOW_MOVED/UNEXPLAINED bucket constants exported |
| `analytics-service/tests/test_parity_diff.py` | Unit tests per bucket; min 40 lines; contains `def test_` | VERIFIED | 138 lines; 11 tests; one per bucket plus tolerance/fail-closed/Calmar-consistency edges |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `nav_twr.py::reconstruct_nav_and_twr` | `NavTWRMeta` (subclass of `ReturnsComputationMeta`, total=False) | returns `(pd.Series, meta)` with `computation_status_hint` | VERIFIED | `NavTWRMeta` at L64; `_build_nav_meta` at L257 builds the meta including `computation_status_hint` |
| `nav_twr.py` | `deribit_txn.py::_row_utc_day` | `from services.deribit_txn import _row_utc_day` at L43 | VERIFIED | Import confirmed; `_row_utc_day` called inside `_flows_to_daily_usd` at L114 |
| `metrics.py::compute_all_metrics` | `returns.dropna().index` span | `_elapsed_days = max((idx[-1]-idx[0]).days, 1)` | VERIFIED | Pattern `.days` present at L484 |
| `metrics.py::calmar` | `cagr / abs(max_dd)` (direct, no qs.stats.calmar) | `_safe_float(cagr / abs(max_dd))` at L503 | VERIFIED | `qs.stats.calmar` grep count = 0 |
| `parity_diff.py::classify_delta` | delta bucket taxonomy | returns one of `UNCHANGED\|REANNUALIZATION\|FLOW_MOVED\|UNEXPLAINED` | VERIFIED | All four labels defined as module constants and returned from `classify_delta` |

---

### Data-Flow Trace (Level 4)

Not applicable — all three artifacts are pure in-process computation modules (no dynamic data rendering, no UI, no API routes). Data flows are verified via the numpy oracle and byte-identity tests above.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| nav_twr.py 13-test suite | `"$PY312" -m pytest tests/test_nav_twr.py -x -q` | 13 passed in 0.84s | PASS |
| metrics + parity 162-test suite | `"$PY312" -m pytest tests/test_metrics_parity.py tests/test_metrics.py -x -q` | 162 passed in 3.85s | PASS |
| parity_diff 11-test suite | `"$PY312" -m pytest tests/test_parity_diff.py -x -q` | 11 passed in 0.86s | PASS |
| nav_twr.py I/O import scan | `grep -nE '(^import\|^from)' nav_twr.py \| grep -vE 'pandas\|numpy\|...'` | no rows | PASS |
| Forbidden denominator scan | `grep -nE '\.replace\(0\|\.clip\(...' nav_twr.py \| grep -v '^#'` | no rows | PASS |
| qs.stats.calmar removed | `grep -c "qs.stats.calmar" metrics.py` | 0 | PASS |
| _CALENDAR_DAYS_PER_YEAR present | `grep -c "_CALENDAR_DAYS_PER_YEAR" metrics.py` | 2 | PASS |
| Risk metrics unchanged (3 of them) | `grep -cE "qs\.stats\.(sharpe\|sortino\|volatility).*periods=periods_per_year" metrics.py` | 3 | PASS |

---

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes defined for this phase. Test suite execution above covers all behavioral checks.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TWR-01 | 73-01-PLAN.md | Backward NAV reconstruction from anchor; numpy-pinned oracle; revert-proof | SATISFIED | `reconstruct_nav` + numpy oracle + mutation test; 13/13 passing |
| TWR-02 | 73-01-PLAN.md | Chain-linked `r_t=(NAV_t-NAV_{t-1}-F_t)/NAV_{t-1}`; flow in numerator; edge cases | SATISFIED | `chain_linked_twr` + all 4 edge cases + compute_twr cross-check |
| DQ-01 | 73-01-PLAN.md | Fail-loud guards on every NAV denominator (dust/negative/flow-dominated); static source-scan | SATISFIED | `_guard_denominator`; `test_dq_guards_flag_not_substitute` + `test_no_forbidden_denominator_guards` |
| TWR-05 | 73-02-PLAN.md | CAGR/Calmar on calendar clock (365); risk metrics stay 252; mutation-verified | SATISFIED | `_CALENDAR_DAYS_PER_YEAR`; direct Calmar; `test_twr05_annualization_split` + `test_calmar_uses_calendar_cagr` |
| ACC-01 (infra) | 73-03-PLAN.md | Series-diff + delta-bucket classifier primitive (full ACC-01 gates in Phase 78) | SATISFIED (infra) | `classify_delta` + 4-bucket constants + 11 synthetic tests; full requirement deferred to Phase 78 per ROADMAP |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | — |

No TBD/FIXME/XXX markers in any phase 73 file. No forbidden denominator substitution patterns in `nav_twr.py`. No placeholders, no stub returns, no hardcoded empty data in production paths.

---

### Human Verification Required

None. This phase delivers pure in-process Python computation modules with no UI, no network calls, no external service dependencies. All correctness properties are verifiable programmatically (oracle tests, mutation tests, static source scans, byte-identity pins).

---

## Gaps Summary

No gaps. All 17 observable truths are VERIFIED against the actual codebase. The phase goal is achieved:

- `services/nav_twr.py` is pure I/O-free (no network imports; stdlib/pandas/numpy/in-repo only).
- The backward NAV roll is correct (numpy oracle + mutation test).
- Chain-linked TWR uses the flow in the numerator (end-of-day convention).
- Every NAV denominator is fail-loud guarded — dust, negative, flow-dominated each produce NaN + `complete_with_warnings`, never a fabricated base. The static source-scan test enforces this contractually.
- `metrics.py` CAGR/Calmar are on the calendar clock; risk metrics stay on 252; mutation-verified both ways.
- `parity_diff.classify_delta` provides the Phase 78 ACC-01 infrastructure bucket classifier.
- All tests (186 total) pass in the CI-matching Python 3.12 venv.

---

_Verified: 2026-07-05T22:30:00Z_
_Verifier: Claude (gsd-verifier)_
