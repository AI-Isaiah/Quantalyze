---
phase: "166"
slug: "qstats-truth-every-quantstats-derived-number-reflects-the-returns-it-was-given"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-24"
---

# Phase 166 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `166-RESEARCH.md` §"Validation Architecture". Decisions: `166-CONTEXT.md` D-01…D-19.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (+ pytest-xdist) for Python; vitest + tsc for the D-12/D-18 TS plan |
| **Config file** | `analytics-service/pytest.ini`; `analytics-service/pyproject.toml` (mypy); `vitest.config.ts` |
| **Quick run command** | from `analytics-service/`: `<main-checkout venv python> -m pytest tests/test_metrics.py tests/test_metrics_parity.py tests/test_qstats_gate.py -q` |
| **Full suite command** | from `analytics-service/`: `<main-checkout venv python> -m pytest -q -n auto` and `<main-checkout venv python> -m mypy --strict --follow-imports=silent services/ routers/ models/`; TS: `./node_modules/.bin/vitest run <touched test files>` + `./node_modules/.bin/tsc --noEmit` through the D-19 symlink |
| **Estimated runtime** | ~5 s quick, ~30 s full Python, TS variable |

The venv python is the main checkout's `analytics-service/.venv/bin/python`, invoked by absolute path
and ALWAYS from the worktree's `analytics-service/` directory (never from the repo root — cassette
misses there make live broker calls). Baseline at HEAD (research): 6109 passed / 90 skipped.

---

## Sampling Rate

- **After every task commit:** quick run command.
- **After every plan wave:** full Python suite + mypy strict (+ vitest/tsc for the TS plan).
- **Before `/gsd-verify-work`:** full suite green, and the D-14 gate neuter drill recorded (RED observed per shape, restored).
- **Max feedback latency:** 60 seconds.

---

## Per-Criterion Verification Map

| Criterion | Behavior | Test Type | Automated Command (from `analytics-service/`) | File Exists | Status |
|-----------|----------|-----------|-----------------------------------------------|-------------|--------|
| SC-1 | Pin stays 0.0.81; decision recorded | unit | `pytest tests/test_metrics.py -k quantstats_pin` | ✅ | ⬜ pending |
| SC-2 | Every allowlisted kwarg leaf behaviourally proven; `cvar`/`payoff_ratio` calibrate RED | unit | `pytest tests/test_qstats_gate.py -k kwarg_proven` | ❌ W0 | ⬜ pending |
| SC-2 | Census printed (arm + reason per node, 30-vs-9 line) on a green run | unit + terminal summary | `pytest tests/test_qstats_gate.py -q` | ❌ W0 | ⬜ pending |
| SC-3 | AST gate RED per shape (direct, not-allowlisted, getattr dispatch, alias, `_rolling_alpha_beta`, new importer), GREEN on clean | unit red/green fixtures | `pytest tests/test_qstats_gate.py -k fixture` | ❌ W0 | ⬜ pending |
| SC-3 | Gate GREEN on real `services/metrics.py`, scanned > 0 | unit | `pytest tests/test_qstats_gate.py -k real_corpus` | ❌ W0 | ⬜ pending |
| SC-4 | Canonical trigger invariants (ulcer 0; recovery/upi/serenity/csr None; PSR > 0.5) | unit, economic | `pytest tests/test_metrics.py -k q166_all_winning` | ❌ W0 | ⬜ pending |
| SC-4 | Non-monotone trigger: kelly/cpc/csr None; shuffle invariance | unit, economic | `pytest tests/test_metrics.py -k "q166_nonmonotone or q166_shuffle"` | ❌ W0 | ⬜ pending |
| SC-4 | Benchmark trigger: r² == corr² of raw pair; β == cov/var; rolling β == rolling cov/var | unit, economic | `pytest tests/test_metrics.py -k q166_benchmark` | ❌ W0 | ⬜ pending |
| SC-4/D-08 | Mirrors == live quantstats on benign fixtures (except D-15/D-16/D-17 disclosed sites, anchored independently) | unit, parity | `pytest tests/test_metrics.py -k q166_parity` | ❌ W0 | ⬜ pending |
| D-15 | NaN-bearing benchmarked series: alpha/beta over complete pairs, None when undefined, never 0.0 | unit | `pytest tests/test_metrics.py -k q166_greeks_nan` | ❌ W0 | ⬜ pending |
| D-16 | PSR equals independent Bailey–López de Prado computation from sample moments | unit | `pytest tests/test_metrics.py -k q166_psr` | ❌ W0 | ⬜ pending |
| D-17 | Rolling alpha equals windowed intercept `mean_w(r) − β_t·mean_w(b)` | unit | `pytest tests/test_metrics.py -k q166_rolling_alpha` | ❌ W0 | ⬜ pending |
| SC-5 | Golden bytes unchanged (or each moved byte has a D-10 row) | integration | `pytest tests/test_metrics_parity.py -q` | ✅ | ⬜ pending |
| D-04 | Primitive extraction byte-neutral before any mirror lands | integration | full suite + parity | ✅ | ⬜ pending |
| D-12/D-18 | Derived KPI strings byte-identical to old literals; RED on a separator mutation | unit (TS) | `./node_modules/.bin/vitest run <pin test>` from repo root | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_qstats_gate.py` — AST gate, red/green fixtures, behavioural kwarg pins, real-corpus run
- [ ] `analytics-service/tests/conftest.py` — `pytest_terminal_summary` census print
- [ ] `analytics-service/tests/test_metrics.py` — Phase 166 section: non-monotone trigger, benchmark trigger, calendar-mismatch fixture, invariant/parity/shuffle tests
- [ ] TS byte pin for the derived KPI strings (D-18)
- [ ] Every new invariant observed RED against HEAD's `services/metrics.py` (neuter → RED → restore) before the mirror lands

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Affected PRODUCTION population census | D-11 / OPEN-2 | No remote database access in this phase | Founder runs the read-only census SQL the SUMMARY carries |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
