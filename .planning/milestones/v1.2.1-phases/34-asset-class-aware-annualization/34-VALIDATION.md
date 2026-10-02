---
phase: 34
slug: asset-class-aware-annualization
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-24
---

# Phase 34 — Validation Strategy

> Per-phase validation contract. The phase is a money/correctness path, so the proof set is
> the gate: (a) default-252 byte-identical, (b) param-rescales-365, (c) equity_reconstruction
> converged to 252, (d) no residual scale factor.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (analytics-service) + vitest (TS parity) |
| **Config file** | `analytics-service/pytest.ini` / `vitest.config.ts` |
| **Quick run command** | `cd analytics-service && python -m pytest tests/test_metrics_parity.py tests/test_mt5_golden_fixtures.py -q` |
| **Full suite command** | `cd analytics-service && python -m pytest -q` then `npm run test -- metrics-parity` |
| **Estimated runtime** | ~60–120 seconds |

---

## Sampling Rate

- **After every task commit:** Run the quick command (the affected metrics/equity test).
- **After every plan wave:** Run the full analytics pytest suite + the TS parity test.
- **Before `/gsd:verify-work`:** Full suite green, including mypy --strict on `metrics.py` / `equity_reconstruction.py`.
- **Max feedback latency:** ~120 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 34-01-xx | 01 | 1 | ANNUAL-01 | — / — | `compute_all_metrics(periods_per_year=252)` default is byte-identical to today | unit | `pytest tests/test_metrics_parity.py -q` | ✅ | ⬜ pending |
| 34-01-xx | 01 | 1 | ANNUAL-04 | — / — | `periods_per_year=365` rescales vol/sharpe/sortino by ≈√(365/252) and CAGR geometrically `(1+c)^(365/252)-1` | unit | `pytest tests/test_metrics_parity.py -q` | ✅ | ⬜ pending |
| 34-02-xx | 02 | 2 | ANNUAL-05 | — / — | `EquityCurveBuilder.compute_sharpe` default 252; ×1.20 mismatch gone; equity-curve goldens recomputed at 252 | unit | `pytest tests/ -k equity -q` | ✅ | ⬜ pending |
| 34-02-xx | 02 | 2 | ANNUAL-02/03 | — / — | both production callers resolve 252; no crypto-365 production path; ranking comparability intact | unit | `pytest tests/test_mt5_golden_fixtures.py -q` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* (test_metrics_parity.py, test_mt5_golden_fixtures.py,
equity-curve-golden fixtures, and src/__tests__/metrics-parity.test.ts already exist; this phase extends them
rather than installing new infra.)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Landing verification-card Sharpe drops ×√(252/365)≈0.831 after convergence | ANNUAL-05 | Visual confirmation on a real allocator landing page (authed) | Optional post-deploy: confirm the displayed Sharpe is lower and matches the 252-basis number; not blocking (covered by the equity-curve golden recompute) |

*All gating phase behaviors have automated verification; the manual check above is advisory.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (none — existing infra)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
